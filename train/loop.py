"""Trains the value network by self-play and TD(lambda).

    python -m train.loop --run data/selfplay/run1 --hours 2

Each iteration plays games with the current network (the first one with the heuristic bot, whose games teach the
network what a position is worth), fits the network to TD(lambda) targets over a window of recent games, exports it
and measures it in the arena against the heuristic bot and against the champion, which only changes when a
candidate beats it. Everything is stored in the run folder, so a run can be stopped and resumed.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from .model import ValueNet
from .returns import lambda_returns
from .shards import PAD, Dataset, iter_samples, read_games, read_header

ROOT = Path(__file__).resolve().parent.parent


def node(*args):
    command = ["node", *[str(a) for a in args]]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{' '.join(command)} failed:\n{result.stderr}")
    return result.stdout.strip().splitlines()[-1]


def selfplay(out, games, policy, net, epsilon, workers, seed):
    args = ["tools/selfplay.mjs", "--out", out, "--games", games, "--policy", policy, "--epsilon", epsilon, "--workers", workers, "--seed", seed]
    if net:
        args += ["--net", net]
    return json.loads(node(*args))


def arena(a, b, games, workers, seed):
    return json.loads(node("tools/arena.mjs", "--a", a, "--b", b, "--games", games, "--workers", workers, "--seed", seed, "--json"))


def pick_device(name):
    if name == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(name)


class DeviceData:
    """The inputs of a dataset as tensors on the training device; padding points at the embedding's zero row."""

    def __init__(self, idx, dense):
        self.idx = idx  # (N, A) int16
        self.dense = dense  # (N, D) float32

    @classmethod
    def from_dataset(cls, ds, device):
        idx = torch.from_numpy(ds.idx.astype(np.int32))
        idx[idx == PAD] = ds.sparse
        return cls(idx.to(torch.int16).to(device), torch.from_numpy(ds.dense).to(device))

    def __len__(self):
        return self.idx.shape[0]

    def batch(self, rows):
        return self.idx[rows].long(), self.dense[rows]

    def tail(self, n):
        return DeviceData(self.idx[-n:], self.dense[-n:])


def load_window(paths, device):
    """Reads shards in blocks straight into tensors on `device`. Returns (games and outcomes, inputs)."""
    headers = [read_header(p) for p in paths]
    if len({(h.sparse, h.features_version, h.dense) for h in headers}) != 1:
        raise ValueError("self-play files were written with different feature sets")
    sparse, width = headers[0].sparse, max(h.used for h in headers)
    total = sum(h.samples for h in headers)
    idx = torch.full((total, width), sparse, dtype=torch.int16, device=device)
    dense = torch.empty((total, headers[0].dense), dtype=torch.float32, device=device)
    teams, game_len, last_team, z = [], [], [], []
    at = 0
    for h in headers:
        lengths, last, outcome = read_games(h)
        game_len.append(lengths)
        last_team.append(last)
        z.append(outcome)
        for idx_block, dense_block, team_block in iter_samples(h):
            n = len(team_block)
            block = idx_block.astype(np.int32)
            block[block == PAD] = sparse
            idx[at:at + n, : block.shape[1]] = torch.from_numpy(block).to(torch.int16).to(device)
            dense[at:at + n] = torch.from_numpy(dense_block).to(device)
            teams.append(team_block.copy())
            at += n
    ds = Dataset(idx=None, dense=None, team=np.concatenate(teams), game_len=np.concatenate(game_len),
                 last_team=np.concatenate(last_team), z=np.concatenate(z), sparse=sparse, features_version=headers[0].features_version)
    return ds, DeviceData(idx, dense)


@torch.no_grad()
def predict(model, data, chunk=262144):
    values = np.empty(len(data), dtype=np.float32)
    for start in range(0, len(data), chunk):
        end = min(len(data), start + chunk)
        logits = model(data.idx[start:end].long(), data.dense[start:end])
        values[start:end] = torch.sigmoid(logits).cpu().numpy()
    return values


def targets_for(model, ds, data, lam):
    # With lambda = 1 the target is the game outcome and the network's own values are not needed.
    values = np.zeros(len(ds), dtype=np.float32) if lam >= 1.0 else predict(model, data)
    return lambda_returns(values, ds.team, ds.game_len, ds.last_team, ds.z, lam)


def outcome_metrics(model, ds, data):
    """How well the network predicts the real outcome of games it has not been fitted to."""
    values = predict(model, data)
    outcome = lambda_returns(values, ds.team, ds.game_len, ds.last_team, ds.z, 1.0)
    p = np.clip(values, 1e-6, 1 - 1e-6)
    decided = outcome != 0.5
    return {
        "bce": float(-(outcome * np.log(p) + (1 - outcome) * np.log(1 - p)).mean()),
        "brier": float(((values - outcome) ** 2).mean()),
        "accuracy": float(((values > 0.5) == (outcome > 0.5))[decided].mean()),
        "mean_value": float(values.mean()),
    }


def fit(model, opt, ds, data, lam, steps, batch, refresh, device):
    """Gradient steps on TD(lambda) targets that are recomputed with the current network every `refresh` steps."""
    def targets():
        return torch.from_numpy(targets_for(model, ds, data, lam)).to(device)

    y = targets()
    n = len(data)
    order = torch.randperm(n, device=device)
    cursor = 0
    losses = torch.zeros(steps, device=device)
    for step in range(steps):
        if step and step % refresh == 0:
            y = targets()
        if cursor + batch > n:
            order = torch.randperm(n, device=device)
            cursor = 0
        rows = order[cursor:cursor + batch]
        cursor += batch
        idx, dense = data.batch(rows)
        loss = F.binary_cross_entropy_with_logits(model(idx, dense), y[rows])
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        losses[step] = loss.detach()
    losses = losses.cpu().numpy()
    tenth = max(1, len(losses) // 10)
    return {"loss_first": float(losses[:tenth].mean()), "loss_last": float(losses[-tenth:].mean())}


def save_json(path, data):
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(data))
    os.replace(tmp, path)


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--run", required=True, help="run folder (kept between runs; use a folder under data/selfplay/)")
    p.add_argument("--iterations", type=int, default=1000)
    p.add_argument("--hours", type=float, default=0.0, help="stop after this many hours (0: no limit)")
    p.add_argument("--hidden", default="192,96")
    p.add_argument("--init", default="", help="start from this network file instead of random weights")
    p.add_argument("--bootstrap-games", type=int, default=100000, help="heuristic games of the first iteration")
    p.add_argument("--bootstrap-epsilon", type=float, default=0.08)
    p.add_argument("--first-steps", type=int, default=3500)
    p.add_argument("--games", type=int, default=40000, help="self-play games per iteration")
    p.add_argument("--epsilon", type=float, default=0.03, help="chance of a random move in self-play")
    p.add_argument("--window", type=int, default=3, help="iterations of games the network is fitted to")
    p.add_argument("--steps", type=int, default=2000)
    p.add_argument("--batch", type=int, default=4096)
    p.add_argument("--refresh", type=int, default=1000, help="steps between recomputing the targets")
    p.add_argument("--lam", type=float, default=0.8, help="TD(lambda); the first iteration uses 1")
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--lr-decay", type=float, default=0.97)
    p.add_argument("--lr-min", type=float, default=1e-4)
    p.add_argument("--arena-games", type=int, default=1500)
    p.add_argument("--gate", type=float, default=0.52, help="win rate against the champion that promotes a candidate")
    p.add_argument("--workers", type=int, default=max(1, min(12, (os.cpu_count() or 4) - 2)))
    p.add_argument("--threads", type=int, default=0, help="torch threads (0: default)")
    p.add_argument("--device", default="auto", help="auto, cpu or cuda")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--publish", default="", help="copy every new champion to this file, e.g. models/champion.json")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    run = (ROOT / args.run).resolve() if not Path(args.run).is_absolute() else Path(args.run)
    run.mkdir(parents=True, exist_ok=True)
    if args.threads:
        torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    device = pick_device(args.device)
    print(f"training on {device}", flush=True)
    started = time.time()

    current_file = run / "net-current.json"
    champion_file = run / "champion.json"
    state_file = run / "state.pt"
    log_file = run / "log.jsonl"

    hidden = tuple(int(x) for x in args.hidden.split(","))
    model = ValueNet(hidden)
    if args.init:
        model = ValueNet.from_json(json.loads(Path(args.init).read_text()))
    model.to(device)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    iteration = 0
    games_total = 0
    if state_file.exists():
        state = torch.load(state_file, map_location=device, weights_only=False)
        model = ValueNet(state["hidden"])
        model.load_state_dict(state["model"])
        model.to(device)
        opt = torch.optim.Adam(model.parameters(), lr=args.lr)
        opt.load_state_dict(state["opt"])
        iteration = state["iteration"]
        games_total = state["games_total"]
        print(f"resuming at iteration {iteration}", flush=True)
    if not current_file.exists():
        save_json(current_file, model.to_json({"iteration": -1}))

    while iteration < args.iterations:
        if args.hours and iteration > 0 and time.time() - started > args.hours * 3600:
            print("time budget used up", flush=True)
            break
        t0 = time.time()
        shard = run / f"iter-{iteration:04d}.bin"
        if iteration == 0 and not args.init:
            play = selfplay(shard, args.bootstrap_games, "heuristic", None, args.bootstrap_epsilon, args.workers, args.seed)
            lam, steps = 1.0, args.first_steps
        else:
            play = selfplay(shard, args.games, "net", current_file, args.epsilon, args.workers, args.seed + iteration * 10_000_000)
            lam, steps = (1.0 if iteration == 0 else args.lam), (args.first_steps if iteration == 0 else args.steps)
        games_total += play["games"]
        t_play = time.time() - t0

        window = [run / f"iter-{i:04d}.bin" for i in range(max(0, iteration - args.window + 1), iteration + 1)]
        window = [w for w in window if w.exists()]
        ds, data = load_window(window, device)
        header = read_header(shard)
        fresh, fresh_data = ds.tail(header.games, header.samples), data.tail(header.samples)
        before = outcome_metrics(model, fresh, fresh_data)

        lr = max(args.lr_min, args.lr * args.lr_decay ** iteration)
        for group in opt.param_groups:
            group["lr"] = lr
        t1 = time.time()
        fit_stats = fit(model, opt, ds, data, lam, steps, args.batch, args.refresh, device)
        t_fit = time.time() - t1
        after = outcome_metrics(model, fresh, fresh_data)
        del data, fresh_data
        if device.type == "cuda":
            torch.cuda.empty_cache()

        meta = {"run": run.name, "iteration": iteration, "games": games_total, "lambda": lam, "created": time.strftime("%Y-%m-%d %H:%M:%S")}
        save_json(current_file, model.to_json(meta))
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "hidden": model.hidden, "iteration": iteration + 1, "games_total": games_total}, state_file)

        seed = 7_000_000 + iteration
        vs_heuristic = arena(f"net:{current_file}", "heuristic", args.arena_games, args.workers, seed)
        promoted = False
        vs_champion = None
        if not champion_file.exists():
            promoted = True
        else:
            vs_champion = arena(f"net:{current_file}", f"net:{champion_file}", args.arena_games, args.workers, seed)
            promoted = vs_champion["aWinRate"] >= args.gate
        if promoted:
            shutil.copyfile(current_file, champion_file)
            if args.publish:
                target = ROOT / args.publish
                target.parent.mkdir(parents=True, exist_ok=True)
                partial = target.with_name(target.name + ".tmp")  # a running server never sees half a file
                shutil.copyfile(current_file, partial)
                os.replace(partial, target)

        record = {
            "iteration": iteration,
            "policy": "heuristic" if iteration == 0 and not args.init else "net",
            "games": play["games"],
            "samples": len(ds),
            "lambda": lam,
            "lr": lr,
            "fit": fit_stats,
            "new_games_before": before,
            "new_games_after": after,
            "vs_heuristic": round(vs_heuristic["aWinRate"], 4),
            "vs_heuristic_low": round(vs_heuristic["low"], 4),
            "vs_champion": None if vs_champion is None else round(vs_champion["aWinRate"], 4),
            "promoted": promoted,
            "avg_turns": play["avgTurns"],
            "seconds": {"selfplay": round(t_play, 1), "fit": round(t_fit, 1), "total": round(time.time() - t0, 1)},
        }
        with open(log_file, "a") as f:
            f.write(json.dumps(record) + "\n")
        champion_text = "-" if vs_champion is None else f"{vs_champion['aWinRate']:.3f}"
        print(
            f"iter {iteration:3d}  games {games_total:8d}  loss {fit_stats['loss_first']:.4f}->{fit_stats['loss_last']:.4f}  "
            f"new-game bce {before['bce']:.4f}->{after['bce']:.4f} acc {after['accuracy']:.3f}  "
            f"vs heuristic {vs_heuristic['aWinRate']:.3f}  vs champion {champion_text}"
            f"{'  PROMOTED' if promoted else ''}  [{record['seconds']['total']:.0f}s]",
            flush=True,
        )
        # Games that have left the window are not needed any more.
        old = run / f"iter-{iteration - args.window:04d}.bin"
        if iteration - args.window >= 0 and old.exists():
            old.unlink()
        iteration += 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
