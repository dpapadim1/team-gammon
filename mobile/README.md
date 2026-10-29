# Team Gammon for iPhone

A [Capacitor](https://capacitorjs.com) app around the web client.

| Part of the app | Where it runs |
|---|---|
| Play against bots | On the phone, no connection needed. `src/js/localServer.js` runs the server's own `Room` and `GameSession` with the bots (including the value network in `models/champion.json`) in the web view, behind the same interface as the socket client, so the board, clocks and rules are exactly those of online play. |
| Tutorial, puzzles, rules, privacy, terms, cookies | Bundled copies of the pages in `client/`. |
| Play online, accounts, leaderboard | The website `https://www.team-gammon.com`, opened inside the app. It is first-party there, so the sign-in cookie, account deletion and everything else work unchanged. A swipe from the left edge goes back; on the site the logo leads back to the app (the site recognises the app by `TeamGammonApp/` in the user agent, see `client/js/main.js`). |

```
mobile/
  src/                 app pages (start page, offline play) and browser shims for node:crypto, node:fs, node:url, Buffer
  scripts/build-www.mjs  assembles www/ from client/, engine/, bots/, part of server/, models/ and src/
  scripts/serve.mjs      serves www/ like the app does, for a desktop browser
  scripts/smoke.mjs      headless Edge at iPhone size: pages, links and a full offline game against level-9 bots
  scripts/render-icons.mjs  draws resources/icon.png and the splash screens from the logo
  ios/                 Xcode project (Swift Package Manager, no CocoaPods)
  capacitor.config.json
```

## Everyday commands (Windows works for all of them)

```
cd mobile
npm.cmd install
npm run serve        # http://127.0.0.1:8100/ - the app's web part in a browser
npm run smoke        # automated check, screenshots in mobile/out/
npm run screenshots  # App Store screenshots (6.9" and 6.3" iPhone) in mobile/screenshots/
npm run preview      # App Store preview video (886 x 1920) in mobile/screenshots/app-preview/
npm run header       # App Store header artwork (5244 x 2950 and 3840 x 1646) in mobile/screenshots/header/ - after npm run screenshots
npm run check-listing  # length check of the store texts in store/listing.md
npm run sync         # rebuild www/ and copy it into ios/ - run after any change to client/, engine/, bots/ or server/
npm run assets       # regenerate the icon and splash images in ios/ from resources/
```

Building the actual iOS binary needs Xcode 26 on a Mac. Without a Mac, the GitHub Actions workflow
[.github/workflows/ios.yml](../.github/workflows/ios.yml) does it on a hosted Mac and uploads the build to TestFlight.

## Publishing to the App Store

1. **Apple Developer Program** (99 USD/year) at https://developer.apple.com/programs/enroll/. Note the 10-character **Team ID** on https://developer.apple.com/account (Membership details).
2. **App record**: in https://appstoreconnect.apple.com, Apps > + > New App: platform iOS, name "Team Gammon", bundle ID `com.dimitrispapadim.teamgammon` (register it first under Certificates, IDs & Profiles > Identifiers if it is not offered), SKU e.g. `teamgammon`.
3. **API key for the build machine**: App Store Connect > Users and Access > Integrations > App Store Connect API > Team Keys > +, access **Admin** (needed so the build can create the signing certificate and profile itself). Download `AuthKey_XXXXXXXXXX.p8` (only possible once) and note the Key ID and the Issuer ID.
4. **Push the repository to GitHub** and add these repository secrets (Settings > Secrets and variables > Actions):
   - `APPLE_TEAM_ID` - the Team ID
   - `ASC_KEY_ID` - the key ID
   - `ASC_ISSUER_ID` - the issuer ID
   - `ASC_KEY_P8_BASE64` - the key file in base64; in PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXXXXXXXX.p8")) | Set-Clipboard`
5. **Build**: Actions > iOS TestFlight > Run workflow (or push a tag `ios-v1.0.0`). Each run uploads a build numbered with the run number; it shows up in App Store Connect > TestFlight after Apple's processing (10-30 min).
6. **Test** on your iPhone with the TestFlight app (add yourself under TestFlight > Internal Testing).
7. **Store listing** in App Store Connect, then Add for Review:
   - Screenshots: `npm run screenshots` writes five PNGs per iPhone slot to `mobile/screenshots/`: `iphone-6.9in-1290x2796` for the 6.9" slot and `iphone-6.3in-1179x2556` for the 6.3" slot (iPhone with Dynamic Island, medium display). Drag each folder's files into the matching slot; any other size is rejected as "invalid dimensions". Accepted portrait sizes are 1260 x 2736, 1290 x 2796 and 1320 x 2868 for 6.9", and 1179 x 2556 and 1206 x 2622 for 6.3".
   - App preview (optional) and texts (subtitle, promotional text, description, keywords, URLs, category): ready to paste from [store/listing.md](store/listing.md). Header artwork (5244 x 2950 or 3840 x 1646): `npm run header`.
   - Privacy policy URL: `https://www.team-gammon.com/privacy`; support URL: `https://www.team-gammon.com/`.
   - App Privacy: data linked to the user = user name and gameplay (ratings, games, chat) for app functionality, only when playing online; no tracking.
   - Age rating questionnaire: answer "yes" to unrestricted user-generated content (chat) if asked.
   - Review notes: offline play needs no account; online play can be tried with "Play as guest".

The workflow archives without code signing, then automatically signs for App Store Connect during export using the API key. No registered device or development provisioning profile is needed for this TestFlight build.

For a new version, raise `MARKETING_VERSION` in `ios/App/App.xcodeproj/project.pbxproj` (both Debug and Release), then run the workflow again.

## Things to know before submitting

- **Chat moderation (App Review guideline 1.2).** Apps with user-generated content must offer a way to report offensive content and to block abusive users, and act on reports. The online chat has neither yet; add both to the website (it is what the app shows) before submitting, or the review is likely to ask for it.
- The app is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`), so no iPad screenshots are needed; iPads run it in iPhone mode. Set it to `"1,2"` in the project to ship a native iPad version.
- Offline games are not rated and not stored; puzzle progress and preferences live in the app's local storage.
- `ios/App/App/public` and `www/` are generated; never edit them by hand.
