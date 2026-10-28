import json
import shutil
import tempfile
import unittest
from pathlib import Path

from train.loop import main


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class PipelineTests(unittest.TestCase):
    def test_a_tiny_run_plays_trains_gates_and_resumes(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp) / "run"
            publish = Path(tmp) / "published" / "champion.json"
            common = [
                "--run", str(run), "--device", "cpu", "--workers", "2", "--hidden", "8,4",
                "--bootstrap-games", "120", "--first-steps", "15", "--games", "60", "--steps", "15", "--refresh", "10",
                "--batch", "256", "--window", "2", "--arena-games", "40", "--publish", str(publish),
            ]
            self.assertEqual(main(common + ["--iterations", "2"]), 0)
            log = [json.loads(line) for line in (run / "log.jsonl").read_text().splitlines()]
            self.assertEqual([r["iteration"] for r in log], [0, 1])
            self.assertEqual(log[0]["policy"], "heuristic")
            self.assertEqual(log[1]["policy"], "net")
            self.assertTrue(log[0]["promoted"], "the first network becomes the champion")
            self.assertIsNone(log[0]["vs_champion"])
            self.assertIsNotNone(log[1]["vs_champion"])
            self.assertTrue(0.0 <= log[1]["vs_heuristic"] <= 1.0)
            self.assertTrue((run / "champion.json").exists())
            self.assertTrue(publish.exists())
            net = json.loads(publish.read_text())
            self.assertEqual(net["format"], "team-gammon-value-net")
            self.assertEqual([layer["out"] for layer in net["layers"]], [8, 4, 1])
            # With a window of two iterations the first shard is gone once the third round has started.
            self.assertEqual(main(common + ["--iterations", "3"]), 0)
            log = [json.loads(line) for line in (run / "log.jsonl").read_text().splitlines()]
            self.assertEqual([r["iteration"] for r in log], [0, 1, 2], "the run continued where it stopped")
            self.assertFalse((run / "iter-0000.bin").exists())
            self.assertTrue((run / "iter-0002.bin").exists())


if __name__ == "__main__":
    unittest.main()
