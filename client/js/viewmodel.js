// Everything the room screens need to know about a `state` snapshot, derived once and free of DOM code.
export function deriveView(state, rules) {
  const game = state.game;
  const you = state.you ?? { seat: null, host: false, suggestions: [] };
  const mySeat = you.seat;
  const myTeam = mySeat ? rules.teamOf[rules.seatIndex.get(mySeat)] : null;
  const live = state.phase === 'playing' && !!game && !game.result;
  const rolled = live && game.dice !== null;
  const actorId = game ? game.actor : null;
  const actorIndex = actorId ? rules.seatIndex.get(actorId) : null;
  const myTurn = rolled && actorId === mySeat;
  const sameTeam = rolled && mySeat !== null && actorId !== mySeat && rules.teamOf[actorIndex] === myTeam;
  const seats = state.seats;
  const humans = rules.seatIds.filter((id) => seats[id]?.kind === 'human');
  return {
    phase: state.phase,
    mySeat,
    myTeam,
    viewTeam: myTeam ?? 0,
    flipped: myTeam === 1,
    isHost: you.host,
    live,
    over: state.phase === 'over',
    rolled,
    myTurn,
    canSuggest: sameTeam && seats[mySeat]?.kind === 'human',
    actorId,
    actorIndex,
    actorName: actorId ? seats[actorId]?.name ?? actorId : null,
    transferred: !!game && game.slotSeat !== game.actor,
    suggestions: you.suggestions ?? [],
    full: rules.seatIds.every((id) => seats[id]),
    humans,
    everyoneReady: humans.every((id) => seats[id].ready),
  };
}

// Pips left and checkers borne off for each seat, in seat order.
export function seatStats(position, rules) {
  return rules.seatIds.map((id, s) => ({ seat: id, pips: position.pipsLeft(s), off: position.off[s], total: rules.checkersPerSeat }));
}

export function teamStats(position, rules) {
  return [0, 1].map((team) => {
    const seats = rules.teamSeats[team];
    return {
      pips: seats.reduce((sum, s) => sum + position.pipsLeft(s), 0),
      off: seats.reduce((sum, s) => sum + position.off[s], 0),
      total: seats.length * rules.checkersPerSeat,
    };
  });
}
