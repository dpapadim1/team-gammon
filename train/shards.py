"""Reads the self-play files written by tools/selfplay.mjs (format described in tools/lib/shards.js)."""
import struct
from dataclasses import dataclass

import numpy as np

HEADER_SIZE = 32
PAD = 0xFFFF
GAME_DTYPE = np.dtype([("samples", "<u4"), ("last_team", "u1"), ("outcome", "u1"), ("pad", "<u2")])
OUTCOME_VALUE = np.array([0.0, 0.5, 1.0], dtype=np.float32)


@dataclass
class Dataset:
    """Samples of whole games in game order.

    idx        (N, A) uint16  active sparse inputs of each sample, padded with PAD
    dense      (N, D) float32 dense inputs
    team       (N,)   uint8   team that has just moved
    game_len   (G,)   int64   samples per game
    last_team  (G,)   uint8   team that made the last move of each game
    z          (G,)   float32 outcome for that team: 0 lost, 0.5 draw, 1 won
    """

    idx: np.ndarray
    dense: np.ndarray
    team: np.ndarray
    game_len: np.ndarray
    last_team: np.ndarray
    z: np.ndarray
    sparse: int
    features_version: int

    def __len__(self):
        return int(self.team.shape[0])

    @property
    def games(self):
        return int(self.game_len.shape[0])

    def tail(self, games, samples):
        """The last `games` games, which hold the last `samples` samples (inputs are not carried over)."""
        return Dataset(idx=None, dense=None, team=self.team[-samples:], game_len=self.game_len[-games:], last_team=self.last_team[-games:],
                       z=self.z[-games:], sparse=self.sparse, features_version=self.features_version)


@dataclass
class Header:
    path: str
    features_version: int
    sparse: int
    max_active: int
    dense: int
    games: int
    samples: int
    used: int  # most active inputs of any sample

    @property
    def sample_dtype(self):
        return np.dtype([("idx", "<u2", (self.max_active,)), ("dense", "<f4", (self.dense,)), ("team", "u1"), ("pad", "u1", (3,))])


def read_header(path):
    with open(path, "rb") as f:
        header = f.read(HEADER_SIZE)
    if header[:4] != b"TGSH":
        raise ValueError(f"{path} is not a self-play file")
    fmt, features, sparse, max_active, dense, record = struct.unpack_from("<6H", header, 4)
    games, samples = struct.unpack_from("<2I", header, 16)
    (used,) = struct.unpack_from("<H", header, 24)
    if fmt != 1:
        raise ValueError(f"unsupported self-play format {fmt}")
    result = Header(str(path), features, sparse, max_active, dense, games, samples, used or max_active)
    if result.sample_dtype.itemsize != record:
        raise ValueError("record size does not match the layout")
    return result


def read_games(header):
    """Samples per game, the team that made each game's last move, and its outcome for that team."""
    rows = np.fromfile(header.path, dtype=GAME_DTYPE, count=header.games, offset=HEADER_SIZE)
    if len(rows) != header.games or int(rows["samples"].sum()) != header.samples:
        raise ValueError(f"{header.path}: game table and sample count disagree")
    return rows["samples"].astype(np.int64), rows["last_team"].copy(), OUTCOME_VALUE[rows["outcome"]]


def iter_samples(header, rows=1 << 20):
    """Yields (idx, dense, team) for consecutive blocks of samples; idx keeps only the columns that are ever used."""
    dtype = header.sample_dtype
    base = HEADER_SIZE + header.games * GAME_DTYPE.itemsize
    for start in range(0, header.samples, rows):
        count = min(rows, header.samples - start)
        block = np.fromfile(header.path, dtype=dtype, count=count, offset=base + start * dtype.itemsize)
        if len(block) != count:
            raise ValueError(f"{header.path} is truncated")
        yield block["idx"][:, : header.used], block["dense"], block["team"]


def read_shard(path):
    with open(path, "rb") as f:
        header = f.read(HEADER_SIZE)
    if header[:4] != b"TGSH":
        raise ValueError(f"{path} is not a self-play file")
    fmt, features, sparse, max_active, dense, record = struct.unpack_from("<6H", header, 4)
    games, samples = struct.unpack_from("<2I", header, 16)
    if fmt != 1:
        raise ValueError(f"unsupported self-play format {fmt}")
    sample_dtype = np.dtype([("idx", "<u2", (max_active,)), ("dense", "<f4", (dense,)), ("team", "u1"), ("pad", "u1", (3,))])
    if sample_dtype.itemsize != record:
        raise ValueError("record size does not match the layout")
    game_rows = np.fromfile(path, dtype=GAME_DTYPE, count=games, offset=HEADER_SIZE)
    rows = np.fromfile(path, dtype=sample_dtype, count=samples, offset=HEADER_SIZE + games * GAME_DTYPE.itemsize)
    if len(game_rows) != games or len(rows) != samples:
        raise ValueError(f"{path} is truncated")
    if int(game_rows["samples"].sum()) != samples:
        raise ValueError(f"{path}: game table and sample count disagree")
    return Dataset(
        idx=np.ascontiguousarray(rows["idx"]),
        dense=np.ascontiguousarray(rows["dense"]),
        team=np.ascontiguousarray(rows["team"]),
        game_len=game_rows["samples"].astype(np.int64),
        last_team=game_rows["last_team"].copy(),
        z=OUTCOME_VALUE[game_rows["outcome"]],
        sparse=sparse,
        features_version=features,
    )


def load_dataset(paths):
    """Concatenates several files and drops the unused columns of the padded index table."""
    parts = [read_shard(p) for p in paths]
    if not parts:
        raise ValueError("no self-play files")
    if len({(p.sparse, p.features_version, p.dense.shape[1]) for p in parts}) != 1:
        raise ValueError("self-play files were written with different feature sets")
    width = max(p.idx.shape[1] for p in parts)
    idx = np.concatenate([np.pad(p.idx, ((0, 0), (0, width - p.idx.shape[1])), constant_values=PAD) for p in parts])
    used = int((idx != PAD).sum(axis=1).max())
    return Dataset(
        idx=np.ascontiguousarray(idx[:, :used]),
        dense=np.concatenate([p.dense for p in parts]),
        team=np.concatenate([p.team for p in parts]),
        game_len=np.concatenate([p.game_len for p in parts]),
        last_team=np.concatenate([p.last_team for p in parts]),
        z=np.concatenate([p.z for p in parts]),
        sparse=parts[0].sparse,
        features_version=parts[0].features_version,
    )
