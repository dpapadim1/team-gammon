# App Store listing (English)

Copy each block into App Store Connect. `npm run check-listing` checks the lengths against Apple's limits.

## Subtitle (max 30)

```
4-player team backgammon
```

## Promotional text (max 170)

```
Backgammon for four: team up with a partner, pin lone enemy checkers and race home together. Play offline against nine bot levels or online with friends.
```

## Description (max 4000)

```
Team Gammon is backgammon for four players in two teams. You and your partner share one board with the other team, each of you moving your own 8 checkers. The first team to bear off all 16 checkers wins.

PIN, BLOCK AND RACE
- Land on a lone enemy checker to pin it, as in the Greek game Plakoto. Nothing is ever sent back: a pinned checker stays frozen until your team lets it go.
- Build points of two or more checkers to block the way.
- Your partner can keep your pins alive, and once one of you has borne off, the other plays both your rolls. Teamwork decides the game.

PLAY OFFLINE AGAINST THE BOTS
- Nine strength levels, from a beginner bot up to a neural-network bot trained on hundreds of thousands of games against itself.
- Fill the other three seats with bots and play anywhere, with no connection and no account.
- Set your team's clock from 5 minutes to 2 hours.

PLAY ONLINE
- Open a table and invite friends with a link, or join a public table.
- Mix people and bots in any seat.
- Rated games, a leaderboard, and table and team chat.
- Play as a guest, or create a free account to keep your rating.

LEARN AND IMPROVE
- A five-lesson interactive tutorial teaches the rules on a real board.
- Puzzles from real bot games: find the best play for the roll. Every answer was checked by letting the strongest bot play the candidate moves out hundreds of times, and your puzzle rating follows your progress.
- The full rules are always one tap away.

Fair dice, no ads, no in-app purchases.
```

## Keywords (max 100, comma-separated, no spaces needed)

```
backgammon,tavli,plakoto,board game,dice,4 player,partner,multiplayer,offline,bots,puzzles,strategy
```

Words already in the app name ("team", "gammon") are indexed anyway, so they are not repeated here.

## Other fields

- Support URL: `https://www.team-gammon.com/`
- Marketing URL (optional): `https://www.team-gammon.com/`
- Privacy policy URL: `https://www.team-gammon.com/privacy`
- Primary category: Games > Board; secondary: Games > Strategy
- Copyright: `2026 <your full name>`

## App preview

`npm run preview` records `screenshots/app-preview/app-preview-886x1920.mp4`: about 27 s of the app (start page, a game against level-9 bots, puzzles, tutorial). It is 886 x 1920 portrait, H.264 High 4.0 at 30 fps and 10 Mbps, with a silent stereo AAC track. App Store Connect takes this size for both the 6.9-inch and the 6.3-inch iPhone slots. The poster frame defaults to 5 s; pick a frame of the game board in App Store Connect.
