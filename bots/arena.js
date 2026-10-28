import { Game, QUADRANT_PLAKOTO_4P, compileVariant, createRng, reverseCycle } from '../engine/index.js';

// Pins created by `steps` when played by `seat` from `position` (position is not modified).
export function countPinsCreated(position, seat, steps) {
  const work = position.clone();
  let created = 0;
  for (const st of steps) {
    const rec = work.applyStep(seat, st.from, st.die);
    if (rec.to !== 0 && rec.pinTo < 0 && work.pinned[rec.to] >= 0) created++;
  }
  return created;
}

// Plays one game; `botFor(seatIndex)` returns the bot controlling that seat.
// cycle: 'random' draws the direction of the turn cycle per game, 'forward' and 'reverse' fix it.
export function playGame({ variant = QUADRANT_PLAKOTO_4P, botFor, seed = 1, firstSlot = null, cycle = 'random', maxTurns = 3000, onTurn = null }) {
  const rng = createRng(seed);
  const reversed = cycle === 'reverse' || (cycle === 'random' && rng.int(2) === 1);
  const played = reversed ? reverseCycle(variant) : variant;
  const S = compileVariant(played).S;
  const game = new Game(played, { firstSlot: firstSlot ?? rng.int(S) });
  const firstActor = game.actor;
  const pinTurns = [];
  while (!game.over && game.turnNumber < maxTurns) {
    const rolled = game.roll(rng.roll());
    if (rolled.passed) {
      if (onTurn) onTurn(game, null);
      continue;
    }
    const seat = game.actor;
    const steps = botFor(seat).chooseTurn(game);
    const pins = countPinsCreated(game.position, seat, steps);
    if (pins > 0) pinTurns.push(game.turnNumber);
    game.playTurn(steps);
    if (onTurn) onTurn(game, steps);
  }
  return { game, firstActor, pinTurns, reversed };
}
