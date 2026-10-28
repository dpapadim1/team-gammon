import unittest

import numpy as np

from train.returns import lambda_returns


def explicit(values, team, game_len, last_team, z, lam):
    """Direct definition: a weighted sum of the later values, each seen from the team of the sample, plus the outcome."""
    out = []
    at = 0
    for g, length in enumerate(game_len):
        for t in range(length):
            mine = team[at + t]

            def seen(value, owner):
                return value if owner == mine else 1.0 - value

            total = 0.0
            for k in range(1, length - t):
                total += (1.0 - lam) * lam ** (k - 1) * seen(values[at + t + k], team[at + t + k])
            total += lam ** (length - 1 - t) * seen(z[g], last_team[g])
            out.append(total)
        at += length
    return np.array(out)


def random_games(rng, games=9, alternating=True):
    game_len = rng.integers(1, 14, size=games)
    team, last_team = [], []
    for length in game_len:
        first = int(rng.integers(0, 2))
        seq = [(first + i) % 2 for i in range(length)] if alternating else [int(x) for x in rng.integers(0, 2, size=length)]
        team.extend(seq)
        last_team.append((seq[-1] + 1) % 2 if alternating else int(rng.integers(0, 2)))
    values = rng.random(int(game_len.sum()))
    z = rng.choice([0.0, 0.5, 1.0], size=games)
    return values, np.array(team, dtype=np.uint8), game_len, np.array(last_team, dtype=np.uint8), z


class LambdaReturns(unittest.TestCase):
    def test_matches_the_direct_definition(self):
        rng = np.random.default_rng(1)
        for alternating in (True, False):
            for lam in (0.0, 0.3, 0.8, 1.0):
                data = random_games(rng, alternating=alternating)
                np.testing.assert_allclose(lambda_returns(*data, lam), explicit(*data, lam), atol=1e-6)

    def test_lambda_one_is_the_game_outcome_seen_from_each_team(self):
        rng = np.random.default_rng(2)
        values, team, game_len, last_team, z = random_games(rng)
        got = lambda_returns(values, team, game_len, last_team, z, 1.0)
        expected = []
        at = 0
        for g, length in enumerate(game_len):
            for t in range(length):
                expected.append(z[g] if team[at + t] == last_team[g] else 1.0 - z[g])
            at += length
        np.testing.assert_allclose(got, expected, atol=1e-7)

    def test_lambda_zero_bootstraps_from_the_next_value(self):
        # Top moved (value 0.4), then Bottom (value 0.7), and Bottom's move ended the game with a win for Bottom.
        values = np.array([0.4, 0.7])
        got = lambda_returns(values, np.array([0, 1], dtype=np.uint8), np.array([2]), np.array([1], dtype=np.uint8), np.array([1.0]), 0.0)
        # Bottom's sample is followed by the finished game (worth 1 to Bottom); Top's sample sees Bottom's value turned around.
        np.testing.assert_allclose(got, [1.0 - 0.7, 1.0], atol=1e-7)

    def test_an_empty_batch(self):
        self.assertEqual(lambda_returns(np.zeros(0), np.zeros(0, dtype=np.uint8), np.zeros(0, dtype=np.int64), np.zeros(0, dtype=np.uint8), np.zeros(0), 0.5).shape, (0,))


if __name__ == "__main__":
    unittest.main()
