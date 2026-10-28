# Team Gammon: rules specification

Variant `quadrant-plakoto-4p`, draft 0.2. Everything here is implemented by the engine in `engine/` and cross-checked against an independent reference implementation in `testkit/oracle.js`. The two open decisions of draft 0.1 are settled (sections 3 and 5).

## 1. Overview

Four players form two teams of two and share one backgammon board. Each player owns 8 checkers that start stacked on one point. Players move their own checkers around the track, trap lone enemy checkers by landing on them (Plakoto-style pinning, no bar, nothing leaves the board), and finally bear off. The first team to bear off all 16 checkers wins.

## 2. Board

24 points, numbered as in standard backgammon seen from the Top team. The centre divider is only decoration: there is no bar.

```
 13 14 15 16 17 18 | 19 20 21 22 23 24     top row, left to right
 12 11 10  9  8  7 |  6  5  4  3  2  1     bottom row, left to right
```

## 3. Seats and turn order

| Seat | Team | Start point | Moves toward | Bears off from | Pips per checker |
|---|---|---|---|---|---|
| t1 | Top | 24 | point 1 (decreasing) | points 1-6 | 24 |
| b1 | Bottom | 1 | point 24 (increasing) | points 19-24 | 24 |
| t2 | Top | 18 | point 1 (decreasing) | points 1-6 | 18 |
| b2 | Bottom | 7 | point 24 (increasing) | points 19-24 | 18 |

The layout is symmetric under a 180 degree rotation (point `p` maps to `25 - p`, Top to Bottom). Each team has 8 x 24 + 8 x 18 = 336 pips to travel.

Seats play in a cycle in which the teams alternate. The cycle is either t1, b1, t2, b2 or t1, b2, t2, b1; the server draws the direction at random for every game, and also draws which seat plays first. Neither cycle is neutral: with competent play the first one favours Bottom and the second favours Top by about 3 points each, so drawing the direction cancels the skew (section 9).

## 4. A turn

1. The server rolls two dice for the seat on turn. A double (both dice equal) gives four moves of that number.
2. Each die moves one checker of the active seat exactly that many points in the seat's direction. A checker may use both dice one after the other.
3. A player must play as many dice as possible. If only one die can be played, the larger one must be played when either can.
4. A seat that cannot play any die passes. The roll is lost and play continues with the next seat.
5. When a seat has borne off all 8 of its checkers, its slot is not skipped: its teammate plays that roll with the teammate's own checkers. A team therefore always rolls once every two slots until it wins.

## 5. Landing, blocking and pinning

A checker may land on a point depending on what is there:

| The destination holds | Result |
|---|---|
| nothing, or only checkers of the mover's own team | allowed; checkers stack, teammates never pin each other |
| exactly one enemy checker (a blot) | allowed; the enemy checker is **pinned** under the mover's checker, unless the sanctuary rule below applies |
| two or more enemy checkers | blocked |
| a pinned enemy checker, with the mover's team as the pinner | allowed; the pinner team may add more checkers on top |
| a pinned checker of the mover's own team | blocked; the pinned team cannot use that point |

A pinned checker cannot move. The pin ends when the last checker of the pinning team leaves the point, whether by moving on or by bearing off. A point holds at most one pinned checker, and pins belong to teams: either seat of the pinner team can keep a pin alive.

**Start-point sanctuary.** A lone checker that stands on its own seat's start point cannot be pinned, so a point cannot be landed on while one is there alone. It applies to the seat's own start point only (t1's lone checker on 18, t2's start, can be pinned) and does not free a checker that is already pinned.

Why it exists: each long-haul seat tends to leave one straggler on its own start point (24 or 1). Without the rule, the opposing long-haul seat arrives there with its stack and pins it, and then neither side can bear off because each has a checker outside home. That stalemate ended 3.3% of heuristic-bot games and 17% of random-bot games under plain pinning; with the sanctuary it never occurred in 12,000 heuristic games. Plain pinning is kept as variant `quadrant-plain-4p` for comparison.

## 6. Bearing off

A seat may bear off only when all of its remaining checkers, pinned ones included, are in its home points. A die bears off a checker that needs exactly that many pips. A larger die may bear off a checker only when the seat has no checker farther from home. Otherwise the die must be used to move a checker inside the board, or it is lost.

## 7. Winning

A team wins the moment all 16 of its checkers have been borne off. The game ends immediately, even if dice are left over. There are no gammon multipliers and no doubling cube.

If no seat can ever move again, the engine ends the game: the team with fewer pips left wins and equal pips are a draw. The sanctuary rule keeps this from happening in practice; the check is a safety net.

## 8. What the engine does not decide

Clocks, the roll itself (the server uses a secure random source), chat, ratings and bot strength belong to the server and bot layers.

## 9. Evidence behind the choices

All numbers come from the scripts in `tools/` (`node tools/explore.mjs`, `node tools/safety.mjs`, `node tools/sim.mjs`). The heuristic bot beats random play about 95% of the time, so it plays well enough to expose rule problems but it is not strong.

**Turn cycle.** 12,000 heuristic games with the direction drawn at random: Top wins 50.6%, Bottom 49.4%. Split by direction, Top wins 47.4% with t1, b1, t2, b2 and 53.9% with t1, b2, t2, b1. With random bots the sides are even (50.5% / 49.5% over 20,000 games), so the skew comes from strategy, not from the board. The seat that moves first also helps its team (52% of decided games).

**Layout and early captures.** The layout 24 + 18 and 1 + 7 was chosen to avoid easy early captures. Measured over the first eight turns of heuristic games, the mean expected number of hittable lone checkers is 0.36 for this layout, 0.36 for corner starts (Top 24 + 13, Bottom 1 + 12) and 0.40 for diagonal corner teams, so the layouts are equal on that measure. What differs:

- t1 and b1 have a completely safe opening on 38.9% of rolls (best-case exposure 0.03), t2 and b2 on only 16.7% (0.33 and 0.22). In the corner layouts the first seats reach 22.2% (Top 24 + 13, Bottom 1 + 12) and 16.7% (diagonal teams).
- The corner layout with Top 24 + 13 and Bottom 1 + 12 has opening rolls that cannot move at all (2.8% for the second seats). This layout has none.

A pin within the first eight turns happens in 89-93% of games for every layout, so early contact comes from a 32-checker, 4-seat board rather than from the start points.

**Game length** (heuristic bots, table turns): 4 checkers per seat gives 48, 6 gives 72 and 8 gives 96. Passes average 6 per game and idle-seat transfers about 4.
