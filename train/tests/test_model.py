import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from train.model import DENSE, SPARSE, ValueNet

ROOT = Path(__file__).resolve().parents[2]


def random_samples(rng, count, max_active=45):
    samples = []
    for _ in range(count):
        n = int(rng.integers(35, max_active))
        idx = rng.choice(SPARSE, size=n, replace=False)
        samples.append({"idx": [int(i) for i in idx], "dense": [float(x) for x in rng.uniform(-1, 1, size=DENSE)]})
    return samples


def torch_logits(net, samples):
    width = max(len(s["idx"]) for s in samples)
    idx = torch.full((len(samples), width), SPARSE, dtype=torch.long)
    for row, s in enumerate(samples):
        idx[row, : len(s["idx"])] = torch.tensor(s["idx"])
    dense = torch.tensor([s["dense"] for s in samples], dtype=torch.float32)
    with torch.no_grad():
        return net(idx, dense).numpy()


def randomised(hidden):
    torch.manual_seed(5)
    net = ValueNet(hidden)
    with torch.no_grad():
        for p in net.parameters():
            p.add_(torch.randn_like(p) * 0.2)
        net.emb.weight[SPARSE].zero_()
    return net


class ValueNetTests(unittest.TestCase):
    def test_padding_changes_nothing(self):
        net = randomised((12, 6))
        rng = np.random.default_rng(1)
        samples = random_samples(rng, 4)
        a = torch_logits(net, samples)
        b = torch_logits(net, samples + [{"idx": list(range(60)), "dense": [0.0] * DENSE}])[:4]
        np.testing.assert_allclose(a, b, atol=1e-5)

    def test_sparse_inputs_equal_a_dense_matrix_product(self):
        net = randomised((12, 6))
        samples = random_samples(np.random.default_rng(2), 5)
        x = torch.zeros(len(samples), SPARSE)
        for row, s in enumerate(samples):
            x[row, s["idx"]] = 1.0
        dense = torch.tensor([s["dense"] for s in samples])
        with torch.no_grad():
            h = torch.relu(x @ net.emb.weight[:SPARSE] + dense @ net.dense_w + net.b1)
            for layer in net.layers:
                h = torch.relu(layer(h))
            expected = net.out(h).squeeze(-1).numpy()
        np.testing.assert_allclose(torch_logits(net, samples), expected, atol=1e-4)

    def test_json_round_trip(self):
        net = randomised((16, 8))
        copy = ValueNet.from_json(json.loads(json.dumps(net.to_json({"iteration": 3}))))
        samples = random_samples(np.random.default_rng(3), 6)
        np.testing.assert_allclose(torch_logits(copy, samples), torch_logits(net, samples), atol=1e-6)
        self.assertEqual(copy.hidden, (16, 8))
        self.assertEqual(net.to_json({"a": 1})["meta"], {"a": 1})

    def test_padding_row_stays_zero_while_training(self):
        net = randomised((8, 4))
        opt = torch.optim.Adam(net.parameters(), lr=0.01)
        samples = random_samples(np.random.default_rng(4), 8)
        samples[0]["idx"] = samples[0]["idx"][:35]
        for _ in range(3):
            loss = torch.nn.functional.binary_cross_entropy_with_logits(torch_logits_grad(net, samples), torch.full((8,), 0.7))
            opt.zero_grad()
            loss.backward()
            opt.step()
        self.assertEqual(float(net.emb.weight[SPARSE].detach().abs().sum()), 0.0)

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_the_javascript_player_computes_the_same_numbers(self):
        for hidden in ((24, 12), (32,), (16, 10, 6)):
            net = randomised(hidden)
            samples = random_samples(np.random.default_rng(6), 12)
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "net.json"
                path.write_text(json.dumps(net.to_json()))
                request = json.dumps({"net": str(path), "samples": samples})
                result = subprocess.run(["node", "tools/net-eval.mjs"], cwd=ROOT, input=request, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            np.testing.assert_allclose(json.loads(result.stdout), torch_logits(net, samples), atol=2e-4, err_msg=str(hidden))


def torch_logits_grad(net, samples):
    width = max(len(s["idx"]) for s in samples)
    idx = torch.full((len(samples), width), SPARSE, dtype=torch.long)
    for row, s in enumerate(samples):
        idx[row, : len(s["idx"])] = torch.tensor(s["idx"])
    return net(idx, torch.tensor([s["dense"] for s in samples], dtype=torch.float32))


if __name__ == "__main__":
    unittest.main()
