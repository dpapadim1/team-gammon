"""Training targets for the value network."""
import numpy as np


def lambda_returns(values, team, game_len, last_team, z, lam):
    """TD(lambda) targets for every sample, from the point of view of the team that has just moved.

    values     (N,) network values of the samples, game after game
    team       (N,) team that has just moved at each sample
    game_len   (G,) samples per game
    last_team  (G,) team that made the last move of each game, whose outcome z is known: 0 lost, 0.5 draw, 1 won

    The value of a position is the chance that the team that has just moved wins, so it flips to 1 - x when the turn
    passes to the other team. The target of sample t mixes the next sample's value and return:
        mix = (1 - lam) * V[t + 1] + lam * R[t + 1]       R[t] = mix, or 1 - mix when the next sample belongs to the other team
    The sample after a game's last one is the finished game with value z. lam = 1 gives the plain game outcome.
    """
    values = np.asarray(values, dtype=np.float64)
    game_len = np.asarray(game_len, dtype=np.int64)
    games = len(game_len)
    if games == 0:
        return np.zeros(0, dtype=np.float32)
    width = int(game_len.max())
    starts = np.concatenate([[0], np.cumsum(game_len)[:-1]])
    t = np.arange(width)[None, :]
    mask = t < game_len[:, None]
    flat = np.where(mask, starts[:, None] + t, 0)
    v = values[flat]
    tm = np.asarray(team)[flat]

    next_r = np.asarray(z, dtype=np.float64).copy()
    next_v = next_r.copy()
    next_team = np.asarray(last_team).copy()
    out = np.zeros((games, width), dtype=np.float64)
    for step in range(width - 1, -1, -1):
        active = game_len > step
        mix = (1.0 - lam) * next_v + lam * next_r
        r = np.where(tm[:, step] == next_team, mix, 1.0 - mix)
        out[:, step] = r
        next_r = np.where(active, r, next_r)
        next_v = np.where(active, v[:, step], next_v)
        next_team = np.where(active, tm[:, step], next_team)
    return out[mask].astype(np.float32)
