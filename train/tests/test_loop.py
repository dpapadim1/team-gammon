import unittest

import numpy as np
import torch

from train.loop import DeviceData, fit, pick_device, predict, targets_for
from train.model import ValueNet
from train.returns import lambda_returns
from train.shards import PAD, Dataset

SPARSE = 30


def synthetic_dataset(games=120, length=8, seed=0):
    """Positions whose first input says whether the team that has just moved went on to win."""
    rng = np.random.default_rng(seed)
    team, idx, last_team, z = [], [], [], []
    for _ in range(games):
        first = int(rng.integers(0, 2))
        seq = [(first + i) % 2 for i in range(length)]
        last = (seq[-1] + 1) % 2
        outcome = float(rng.integers(0, 2))
        team.extend(seq)
        last_team.append(last)
        z.append(outcome)
        for t in seq:
            wins = outcome if t == last else 1.0 - outcome
            row = [0 if wins == 1.0 else 1] + [int(x) for x in rng.choice(np.arange(2, SPARSE), size=3, replace=False)]
            idx.append(row + [PAD])
    n = games * length
    return Dataset(
        idx=np.array(idx, dtype=np.uint16),
        dense=np.zeros((n, 3), dtype=np.float32),
        team=np.array(team, dtype=np.uint8),
        game_len=np.full(games, length, dtype=np.int64),
        last_team=np.array(last_team, dtype=np.uint8),
        z=np.array(z, dtype=np.float32),
        sparse=SPARSE,
        features_version=1,
    )


class LoopTests(unittest.TestCase):
    def test_padding_is_mapped_to_the_zero_row(self):
        ds = synthetic_dataset(games=2)
        data = DeviceData.from_dataset(ds, pick_device("cpu"))
        idx, dense = data.batch(torch.arange(4))
        self.assertEqual(idx.dtype, torch.long)
        self.assertTrue(bool((idx[:, -1] == SPARSE).all()))
        self.assertTrue(bool((idx[:, :-1] < SPARSE).all()))
        self.assertEqual(tuple(dense.shape), (4, 3))

    def test_fitting_learns_a_pattern_that_the_inputs_reveal(self):
        torch.manual_seed(1)
        device = pick_device("cpu")
        ds = synthetic_dataset()
        data = DeviceData.from_dataset(ds, device)
        model = ValueNet((16, 8), sparse=SPARSE, dense=3).to(device)
        opt = torch.optim.Adam(model.parameters(), lr=0.02)
        stats = fit(model, opt, ds, data, 1.0, steps=150, batch=64, refresh=50, device=device)
        self.assertLess(stats["loss_last"], 0.1)
        self.assertLess(stats["loss_last"], stats["loss_first"])
        target = lambda_returns(np.zeros(len(ds), np.float32), ds.team, ds.game_len, ds.last_team, ds.z, 1.0)
        values = predict(model, data)
        self.assertGreater(float(values[target == 1].mean()), 0.9)
        self.assertLess(float(values[target == 0].mean()), 0.1)

    def test_targets_bootstrap_from_the_network_unless_lambda_is_one(self):
        device = pick_device("cpu")
        ds = synthetic_dataset(games=10)
        data = DeviceData.from_dataset(ds, device)
        model = ValueNet((8,), sparse=SPARSE, dense=3).to(device)
        mc = targets_for(model, ds, data, 1.0)
        td = targets_for(model, ds, data, 0.5)
        self.assertEqual(mc.shape, td.shape)
        self.assertFalse(np.allclose(mc, td))
        self.assertTrue(set(np.unique(mc)).issubset({0.0, 1.0}))


if __name__ == "__main__":
    unittest.main()
