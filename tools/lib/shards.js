import fs from 'node:fs';
import { DENSE_COUNT, FEATURES_VERSION, MAX_ACTIVE, SPARSE_COUNT } from '../../bots/features.js';

// Self-play data file. Little endian.
//   header, 32 bytes: "TGSH", u16 format, u16 features version, u16 sparse count, u16 max active, u16 dense count,
//                     u16 record size, u32 games, u32 samples, u16 largest number of active inputs actually used, 6 reserved bytes
//   game table, 8 bytes per game: u32 samples, u8 team that made the last move, u8 outcome for that team
//                     (0 lost, 1 draw, 2 won), u16 reserved
//   samples, 144 bytes each: u16 idx[64] padded with 0xFFFF, f32 dense[3], u8 team that just moved, 3 bytes padding
// A game contributes the position after each turn except the last one, whose value is the outcome itself.
export const FORMAT_VERSION = 1;
export const HEADER_SIZE = 32;
export const GAME_SIZE = 8;
export const RECORD_SIZE = 2 * MAX_ACTIVE + 4 * DENSE_COUNT + 4;
export const PAD = 0xffff;
const MAGIC = 'TGSH';

export class ShardBuilder {
  constructor() {
    this.samples = Buffer.alloc(RECORD_SIZE * 4096);
    this.games = Buffer.alloc(GAME_SIZE * 256);
    this.sampleCount = 0;
    this.gameCount = 0;
    this.gameStart = 0;
    this.usedActive = 0;
  }

  addSample(feat, team) {
    if (this.sampleCount * RECORD_SIZE >= this.samples.length) {
      const bigger = Buffer.alloc(this.samples.length * 2);
      this.samples.copy(bigger);
      this.samples = bigger;
    }
    const base = this.sampleCount * RECORD_SIZE;
    const buf = this.samples;
    for (let i = 0; i < MAX_ACTIVE; i++) buf.writeUInt16LE(i < feat.n ? feat.idx[i] : PAD, base + 2 * i);
    let at = base + 2 * MAX_ACTIVE;
    for (let d = 0; d < DENSE_COUNT; d++, at += 4) buf.writeFloatLE(feat.dense[d], at);
    buf.writeUInt8(team, at);
    buf.fill(0, at + 1, base + RECORD_SIZE);
    if (feat.n > this.usedActive) this.usedActive = feat.n;
    this.sampleCount++;
  }

  // Closes the game that started after the previous call; outcome is 0, 1 or 2 for the team that made the last move.
  endGame(lastTeam, outcome) {
    if (this.gameCount * GAME_SIZE >= this.games.length) {
      const bigger = Buffer.alloc(this.games.length * 2);
      this.games.copy(bigger);
      this.games = bigger;
    }
    const base = this.gameCount * GAME_SIZE;
    this.games.writeUInt32LE(this.sampleCount - this.gameStart, base);
    this.games.writeUInt8(lastTeam, base + 4);
    this.games.writeUInt8(outcome, base + 5);
    this.games.writeUInt16LE(0, base + 6);
    this.gameCount++;
    this.gameStart = this.sampleCount;
  }

  // Forgets the samples of the game in progress.
  discardGame() {
    this.sampleCount = this.gameStart;
  }

  parts() {
    return {
      games: this.games.subarray(0, this.gameCount * GAME_SIZE),
      samples: this.samples.subarray(0, this.sampleCount * RECORD_SIZE),
      gameCount: this.gameCount,
      sampleCount: this.sampleCount,
      usedActive: this.usedActive,
    };
  }
}

// parts: [{games, samples, gameCount, sampleCount}] from several builders; written as one file.
export function writeShard(path, parts) {
  const header = Buffer.alloc(HEADER_SIZE);
  header.write(MAGIC, 0, 'ascii');
  header.writeUInt16LE(FORMAT_VERSION, 4);
  header.writeUInt16LE(FEATURES_VERSION, 6);
  header.writeUInt16LE(SPARSE_COUNT, 8);
  header.writeUInt16LE(MAX_ACTIVE, 10);
  header.writeUInt16LE(DENSE_COUNT, 12);
  header.writeUInt16LE(RECORD_SIZE, 14);
  header.writeUInt32LE(parts.reduce((n, p) => n + p.gameCount, 0), 16);
  header.writeUInt32LE(parts.reduce((n, p) => n + p.sampleCount, 0), 20);
  header.writeUInt16LE(Math.max(0, ...parts.map((p) => p.usedActive ?? MAX_ACTIVE)), 24);
  const fd = fs.openSync(path, 'w');
  try {
    fs.writeSync(fd, header);
    for (const p of parts) fs.writeSync(fd, p.games);
    for (const p of parts) fs.writeSync(fd, p.samples);
  } finally {
    fs.closeSync(fd);
  }
}

// Reads a whole file; meant for tests and small inspections (training reads it with numpy).
export function readShard(path) {
  const buf = fs.readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== MAGIC) throw new Error('not a self-play file');
  const info = {
    format: buf.readUInt16LE(4),
    featuresVersion: buf.readUInt16LE(6),
    sparse: buf.readUInt16LE(8),
    maxActive: buf.readUInt16LE(10),
    dense: buf.readUInt16LE(12),
    recordSize: buf.readUInt16LE(14),
    gameCount: buf.readUInt32LE(16),
    sampleCount: buf.readUInt32LE(20),
    usedActive: buf.readUInt16LE(24),
  };
  if (info.recordSize !== RECORD_SIZE) throw new Error('unexpected record size');
  const games = [];
  for (let g = 0; g < info.gameCount; g++) {
    const base = HEADER_SIZE + g * GAME_SIZE;
    games.push({ samples: buf.readUInt32LE(base), lastTeam: buf.readUInt8(base + 4), outcome: buf.readUInt8(base + 5) });
  }
  const start = HEADER_SIZE + info.gameCount * GAME_SIZE;
  const samples = [];
  for (let i = 0; i < info.sampleCount; i++) {
    const base = start + i * RECORD_SIZE;
    const idx = [];
    for (let k = 0; k < MAX_ACTIVE; k++) {
      const v = buf.readUInt16LE(base + 2 * k);
      if (v !== PAD) idx.push(v);
    }
    const dense = [];
    for (let d = 0; d < DENSE_COUNT; d++) dense.push(buf.readFloatLE(base + 2 * MAX_ACTIVE + 4 * d));
    samples.push({ idx, dense, team: buf.readUInt8(base + 2 * MAX_ACTIVE + 4 * DENSE_COUNT) });
  }
  return { info, games, samples };
}
