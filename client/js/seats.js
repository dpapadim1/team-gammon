// Seat colours follow team-chess: Top is silver and bronze, Bottom is pearl black and gold.
// The numeral on a checker (1 or 2) tells the seats of a team apart without relying on colour.
export const SEAT_STYLE = Object.freeze({
  t1: { name: 'Silver', light: '#f3f3f3', mid: '#cfcfcf', dark: '#8c8c8c', ink: '#23262b' },
  t2: { name: 'Bronze', light: '#f2b46f', mid: '#d58a3a', dark: '#8a531a', ink: '#2b1704' },
  b1: { name: 'Pearl', light: '#55555e', mid: '#2a2a30', dark: '#0a0a0d', ink: '#f2f2f2' },
  b2: { name: 'Gold', light: '#f8e792', mid: '#e0c95b', dark: '#9c8420', ink: '#2c2506' },
});

const FALLBACK = { name: 'Seat', light: '#dddddd', mid: '#aaaaaa', dark: '#666666', ink: '#111111' };

export function seatStyle(seatId) {
  return SEAT_STYLE[seatId] ?? FALLBACK;
}

export function seatNumeral(seatId) {
  return seatId.slice(1);
}

export const TEAM_NAMES = Object.freeze(['Top', 'Bottom']);
