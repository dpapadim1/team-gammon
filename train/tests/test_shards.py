import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np

from train.shards import PAD, load_dataset, read_header, read_shard

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class ShardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.files = []
        cls.summaries = []
        for seed in (1, 2):
            out = Path(cls.tmp.name) / f"s{seed}.bin"
            result = subprocess.run(
                ["node", "tools/selfplay.mjs", "--out", str(out), "--games", "6", "--workers", "2", "--policy", "heuristic", "--seed", str(seed)],
                cwd=ROOT, capture_output=True, text=True,
            )
            assert result.returncode == 0, result.stderr
            cls.files.append(out)
            cls.summaries.append(json.loads(result.stdout.strip().splitlines()[-1]))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_the_file_written_by_node_reads_back(self):
        ds = read_shard(self.files[0])
        self.assertEqual(ds.games, 6)
        self.assertEqual(len(ds), self.summaries[0]["samples"])
        self.assertEqual(int(ds.game_len.sum()), len(ds))
        self.assertEqual(ds.features_version, 2)
        self.assertEqual(ds.sparse, 1001)
        self.assertEqual(ds.dense.shape[1], 16)

    def test_samples_describe_whole_alternating_games(self):
        ds = read_shard(self.files[0])
        at = 0
        for g, length in enumerate(ds.game_len):
            team = ds.team[at:at + length]
            self.assertTrue(np.all(team[1:] != team[:-1]), "teams alternate every turn")
            self.assertNotEqual(ds.last_team[g], team[-1])
            at += length
        self.assertTrue(set(np.unique(ds.z)).issubset({0.0, 0.5, 1.0}))
        active = ds.idx != PAD
        self.assertTrue(np.all(ds.idx[active] < ds.sparse))
        units = ((ds.idx < 768) | ((ds.idx >= 864) & (ds.idx < 896))) & active
        self.assertTrue(np.all(units.sum(axis=1) == 32), "every position has its 32 checkers")
        self.assertTrue(np.all(active[:, :34].all(axis=1)), "32 checker units and two context units are always active")
        self.assertTrue(np.all(np.diff(active.astype(int), axis=1) <= 0), "padding only follows the active inputs")

    def test_several_files_are_joined(self):
        ds = load_dataset(self.files)
        self.assertEqual(ds.games, 12)
        self.assertEqual(len(ds), int(ds.game_len.sum()))
        self.assertLessEqual(ds.idx.shape[1], 112)

    def test_the_header_says_how_many_inputs_are_ever_used(self):
        header = read_header(self.files[0])
        ds = read_shard(self.files[0])
        self.assertEqual(header.used, int((ds.idx != PAD).sum(axis=1).max()))
        self.assertEqual((header.games, header.samples), (ds.games, len(ds)))

    def test_streaming_a_window_gives_the_same_tables_as_loading_it(self):
        import torch

        from train.loop import DeviceData, load_window

        ds = load_dataset(self.files)
        expected = DeviceData.from_dataset(ds, torch.device("cpu"))
        meta, data = load_window(self.files, torch.device("cpu"))
        self.assertTrue(torch.equal(data.idx, expected.idx))
        self.assertTrue(torch.equal(data.dense, expected.dense))
        for name in ("team", "game_len", "last_team", "z"):
            np.testing.assert_array_equal(getattr(meta, name), getattr(ds, name))
        last = read_header(self.files[1])
        tail = data.tail(last.samples)
        self.assertTrue(torch.equal(tail.idx, expected.idx[-last.samples:]))
        self.assertEqual(len(meta.tail(last.games, last.samples)), last.samples)


if __name__ == "__main__":
    unittest.main()
