import { enumerateTurns } from '../engine/index.js';

// Bot interface: chooseTurn(game) returns the steps ({from, die}) of one legal full turn.
export function createRandomBot(rng) {
  return {
    name: 'random',
    chooseTurn(game) {
      const turns = enumerateTurns(game.position, game.actor, game.dice, { limits: game.limits });
      return turns[rng.int(turns.length)].steps;
    },
  };
}
