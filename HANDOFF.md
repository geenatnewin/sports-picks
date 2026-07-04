# Dylan Harper's "Trust Me" Locks — Handoff

**Last updated:** July 3, 2026 (evening, end of Session 10)
**Project location:** `C:\Users\Navin\Desktop\sports-picks`
**Live site:** https://dylanharperpicks.vercel.app
**GitHub:** https://github.com/geenatnewin/sports-picks (connected to Vercel — push to `main` auto-deploys)

---

## What this is

A sports betting picks web app covering the **2026 World Cup**. It pulls real sportsbook odds (moneyline/spread/totals + player props), prediction-market probabilities (Kalshi + Polymarket), team stats, and recent form, feeds it all to Claude, and shows **two** AI picks per match, ranked purely by how likely each is to actually hit (Moneyline/Tie, Spread, Totals, and player props are all eligible candidates — no separate "value" pick, and the AI is explicitly told not to just mechanically grab the two shortest-odds favorites). Each pick has its own explanation and an optional "counterpoint" — only shown when there's a genuine, credible reason it might not hit, omitted entirely for near-locks (kept deliberately, confirmed cheap to keep — see Session 7). There's also a right-side **"AI Parlay" box** (Session 10): the same AI call also builds one best 3- or 4-leg parlay for the day across all matches, shown with combined odds and an "Add All to Parlay Slip" button. Plus a manual Game/Player Props browser you can tap to build a parlay, track placed slips, and a floating "My Picks" panel. Golf support was fully removed in Session 5; **MLB support was added in Session 7 and fully removed again in Session 9** (see below) — both were built, shipped, then deleted once no longer wanted.

Branding: displayed name is **"Dylan Harper's 'Trust Me' Locks"**. The codebase/repo/folder are still named `sports-picks` — only the Vercel project itself was renamed to `dylanharperpicks`.

---

## Current mode: LIVE — real AI picks are active

`MOCK_PICKS = false` in `src/app/api/picks/route.ts`. Real Claude-generated picks are live in production. `ANTHROPIC_API_KEY` is set on Vercel (added ~July 1 night). **This now spends real Anthropic API credits on each cache-miss refresh** — see caching note below.

**Caching:** the 20-minute picks cache was rebuilt on `unstable_cache` (Next's persistent Data Cache) instead of a plain in-memory variable, because the in-memory version reset on every cold serverless instance and was silently re-billing Anthropic far more than intended. Errors are not cached, so a failed AI call retries fresh next time instead of getting stuck.

**Fixed:** matches used to disappear from the app the instant kickoff passed, which is why the site was showing "0 upcoming picks" during schedule gaps even when a match was actually being played. `getWorldCupOdds()` now cross-checks The Odds API's scores endpoint (`completed` flag) and only drops matches confirmed finished — in-play matches stay visible with a pulsing **LIVE** badge. **Verified live as of July 3, 2026 ~03:02 UTC:** `/api/odds` correctly returned a live match (Switzerland vs Algeria, kicked off 11:00 PM, `isLive: true`) instead of showing nothing.

**New: pick-accuracy tracking.** Every AI pick is graded against real final scores once a match finishes (via the existing Odds API scores endpoint) and stored in a Vercel Blob store. Aggregate win rate (overall + per market type) is fed back into the prompt as a calibration signal for future picks — no dashboard/UI for this yet, it's purely feeding the model.

**New: line-divergence flag.** `getLineDivergence()` in `src/lib/odds.ts` compares implied win probability for the same moneyline outcome across all shopped bookmakers and flags matches where the spread is unusually wide (≥12 points, needs 3+ books quoting to avoid noise on thin markets). Surfaced as an amber "Unusual line movement" badge on Game Props cards, and fed into the AI prompt as a reason to lower confidence — explicitly instructed to never claim/imply a match is fixed and to never treat it as directional. This is a cheap DIY approximation of what real integrity-monitoring services (IBIA, Sportradar) do with data this app doesn't have access to (account-level bet volume) — a soft "worth a second look" flag, not a fixing detector. Verified live: current matches show normal ~3-4pt spreads, correctly unflagged.

**MLB was added in Session 7 and fully removed in Session 9** — see the Session 9 log entry for why and what changed. The app is soccer-only again as of this session.

---

## Data sources

| Source | Used for | Auth | Notes |
|---|---|---|---|
| The Odds API | Sportsbook odds (moneyline, spread, totals) | `ODDS_API_KEY` in `.env.local` | Sources FanDuel, DraftKings, BetMGM, Caesars (`williamhill_us`), ESPN Bet — shops for the best price per outcome across all of them. Up to 10 bookmakers = 1 billing "region", so this costs the same as just using 2 books. Sport key `soccer_fifa_world_cup`. |
| football-data.org | Soccer team group-stage standings/form + last-5-match history | `FOOTBALL_DATA_API_KEY` | Feeds team records AND each team's actual last-5-result history (result, score, opponent) into the AI prompt. A shared `getMatchRecentForm()` helper feeds both the AI prompt and the visible Game Props card. |
| Kalshi | Prediction market win probabilities | None (public API) | Series `KXWCGAME` — `lib/predictionMarkets.ts`. Feeds the pick/confidence but the AI is instructed not to cite Kalshi/Polymarket by name in visible explanations. |
| Polymarket | Prediction market win probabilities | None (public API) | `gamma-api.polymarket.com/public-search`, matched by team names in event title. Same "don't cite the source" rule as Kalshi. |
| PropLine | Player props | Same shape as The Odds API | Anytime goalscorer (top 5) + 2+ assists (top 3), sport key `soccer_fifa_world_cup`. Own event IDs, matched to existing matches by team name. Feeds the same two-pick system as a candidate outcome, not a separate feature. |
| Anthropic | Generates the actual pick + explanation | `ANTHROPIC_API_KEY` | **Active in production.** Prompt explicitly asks for player tendencies, tactical/matchup knowledge, head-to-head history, and weighs strength-of-schedule. Also fed a running pick-accuracy calibration signal and instructed to lower confidence on line-divergence-flagged matches. |

Golf (DataGolf) was removed entirely in Session 5. MLB (its own odds/standings/prediction-market/player-prop pipeline plus a second Anthropic call) was added in Session 7 and removed entirely in Session 9 — neither is in the codebase anymore.

Match filtering: shows **today's matches**, or if none today, just the **single next upcoming match**. Timezone-safe (anchored to America/New_York regardless of server timezone). AI-prompt generation caps at 6 matches for cost control, even though the Game Props browser (`/api/odds`) shows the full uncapped list.

Terminology: sportsbook/UI "Draw" outcome is normalized to **"Tie"** everywhere (odds display, AI prompt, mock picks), and recent-form results show as W/L/**T** (not D) under a fixed **"L5"** header.

---

## Key files

```
src/
  app/
    api/
      picks/route.ts       ← generatePicks(), one unstable_cache entry. MOCK_PICKS toggle, JSON sanitizer.
      odds/route.ts        ← Formats raw odds into browsable markets for the Game Props UI.
    page.tsx                ← Homepage: left sidebar (branding + Refresh), main World Cup section + Game/Player Props tabs, right-side AI Parlay column
    globals.css              ← Theme, "3D" depth utility classes (card-elevated, chip-elevated, btn-raised, panel-elevated-*, chip-selected)
  components/
    MarketsBrowser.tsx     ← Per-match cards: odds + AI pick summary + L5 form chips + tap-to-open detail modal.
    AiParlayBox.tsx         ← NEW (Session 10). Right-side box rendering the AI's best 3-4 leg parlay, combined odds via lib/parlay.ts, "Add All to Parlay Slip" button.
    ParlaySlip.tsx         ← Bottom parlay builder bar, Place Bet flow
    MyPicksPanel.tsx        ← Floating button + slide-out "My Picks" drawer
    MySlips.tsx             ← Renders placed slip history (used inside MyPicksPanel)
  lib/
    odds.ts                ← Odds/scores fetching. getWorldCupOdds(). getBestLine, getLineDivergence, formatAmericanOdds.
    soccer.ts              ← football-data.org client (standings + getTeamRecentForm + shared getMatchRecentForm helper)
    predictionMarkets.ts   ← Kalshi (series KXWCGAME) + Polymarket clients.
    propline.ts            ← PropLine client. getWorldCupPlayerProps().
    pickHistory.ts         ← Grades finished picks against real scores, stores/aggregates win-rate in Vercel Blob for prompt calibration.
    parlay.ts              ← Parlay odds math (American ↔ decimal, payout calc), PlacedSlip type — also reused client-side to compute the AI Parlay's combined odds.
    types.ts                ← Shared types. PicksResponse has `worldcup` and `parlay` (AiParlay | null).
```

---

## Deployment notes (important)

- **Vercel project name:** `dylanharperpicks` (renamed from `sports-picks`)
- **Alias does NOT auto-update — confirmed this also applies to git-push auto-deploys, not just manual `vercel --prod`.** On July 3, two pushes to `main` (`d06dc34`, `633d668`) built and went Ready in Vercel but `dylanharperpicks.vercel.app` stayed pinned to a build from 20+ hours earlier — the site was silently serving old code the whole time. After every deploy (git push OR manual), run:
  ```
  vercel alias set <new-deployment-url> dylanharperpicks.vercel.app
  ```
  Check with `vercel inspect dylanharperpicks.vercel.app` if unsure what's actually live. Consider this the default suspect any time the live site doesn't reflect a recent commit.
- **SSO/deployment protection** was accidentally on for a while previously, silently gating every new deployment behind a Vercel login wall. Disabled via `vercel project protection disable dylanharperpicks --sso`. If the live site ever starts redirecting to a Vercel login page again, that setting is the first thing to check.
- Production env vars currently set: `ODDS_API_KEY`, `FOOTBALL_DATA_API_KEY`, `ANTHROPIC_API_KEY`, `PROPLINE_API_KEY`, `BLOB_READ_WRITE_TOKEN` (verified present as of this session's start — all encrypted, all in Production). `DATAGOLF_API_KEY` no longer applies, golf was removed.
- **`ODDS_API_KEY`, `FOOTBALL_DATA_API_KEY`, and `ANTHROPIC_API_KEY` are marked Sensitive on Vercel** — write-only, cannot be read back even via `vercel env pull`. Local `.env.local` has these three intentionally blank (only `BLOB_READ_WRITE_TOKEN` and `PROPLINE_API_KEY` are real locally) — this looks like a deliberate safety net against accidentally burning real Anthropic tokens from a stray local `npm run dev`, so don't "fix" it by filling them in without thinking it through. It does mean local dev can't fetch real odds or hit the real AI even with `MOCK_PICKS = true` (mock mode still needs real odds data as its base) — testing UI changes locally requires either temporarily pasting in a real `ODDS_API_KEY` (fine, that one's not the expensive one) or just deploying and checking live.
- Git commit email fixed here too (see [[feedback-vercel-git-email]]) — set to `297332550+geenatnewin@users.noreply.github.com` for this repo as a precaution, though this repo's deploys were building fine even before the fix (unlike synleague's).
- **The alias-staleness issue keeps recurring** — happened again this session (a push went Ready in Vercel but `dylanharperpicks.vercel.app` still served an old build). Don't assume a `git push` alone means the live site updated; always verify with `vercel inspect dylanharperpicks.vercel.app` and realias if needed. This has now happened enough times to just treat as expected behavior, not a one-off.
---

## What's left to do

- [ ] **Not yet verified against a real AI call**: Session 8's prompt tightening, Session 9's MLB removal, and Session 10's AI Parlay feature all shipped on typecheck/build confidence only — worth a spot-check of real output next time picks are naturally viewed live, especially whether the AI actually returns `parlay: null` appropriately vs. forcing a weak combination.
- [ ] Consider adding NBA or another sport again someday — discussed a few times but not started fresh since MLB was removed. If revisited, treat it as new work rather than resurrecting the deleted MLB code.
- [ ] Watch for a repeat of the truncated-JSON issue fixed in Session 5 (max_tokens bump) if output grows further
- [ ] Player Props tab is still a "coming soon" placeholder — PropLine data feeds the AI prompt but was never built into a browsable tab UI

## Session Log

### Session 1 (initial) — June 30, 2026
- Built the full Next.js app from scratch: World Cup + golf odds, football-data.org stats, DataGolf, Claude-generated picks

### Session 2 — July 1-2, 2026 (long session)
- Got real API keys working (Odds API, football-data.org, Anthropic); fixed a stale-placeholder bug where Vercel prod env vars still had old placeholder text after local `.env.local` was updated
- Full visual redesign: dark warm palette, red accent, "3D" elevation pass on cards/buttons/panels
- Rebranded 3 times: HarpPICKS → SHARPERPICKS → "Dylan Harper's 'Trust Me' Locks"
- Added Game Props browsing (moneyline/spread/totals, shop-for-best-price across 5 sportsbooks) and merged AI picks directly into each match card instead of a separate list
- Simplified AI output from two picks (highest%/highest value) to one ("highest % to hit" only), reformatted explanations as short bullet points, moved full explanation into a tap-to-open detail modal
- Built full parlay system: tap-to-select odds, live parlay slip with odds/payout calculation, Place Bet flow, persisted "My Slips" history, floating "My Picks" side panel
- Added Kalshi + Polymarket prediction market data into the AI prompt (both free, no-auth)
- Fixed a real bug: Claude Sonnet 5's default adaptive-thinking block shifted the actual text response out of `content[0]`, silently breaking JSON parsing
- Fixed a timezone bug: match date filtering used server-local time (UTC on Vercel, Eastern locally), causing production to show a different date window than local dev
- Added `MOCK_PICKS` preview mode + a 20-minute cache on `/api/picks` to control Anthropic API spend
- Renamed the Vercel project, hit and fixed an accidental SSO deployment-protection wall
- Deployed to `dylanharperpicks.vercel.app`, connected to GitHub for auto-deploy

### Session 3 — July 1-2, 2026 (this session — user forgot to end previous session, so this covers unlogged changes)
- **Activated real AI picks for launch** — flipped `MOCK_PICKS` to `false` now that `ANTHROPIC_API_KEY` was confirmed on Vercel prod
- Fixed a JSON parse failure on every real (non-mock) request: prompt asked for raw line breaks inside bullets, which is invalid inside a JSON string; switched to `\n` escapes plus added a sanitizer for stray control characters as a safety net
- Rebuilt the picks cache on `unstable_cache` (persistent Data Cache) instead of a plain in-memory variable — the in-memory version reset per cold serverless instance, silently re-billing Anthropic far more often than the intended 20-minute TTL
- Expanded the AI prompt to explicitly draw on individual player tendencies, tactical style matchups, and head-to-head/tournament history, and to weigh strength-of-schedule (a close loss to an elite squad should outweigh a similar record against weak opposition)
- Hid Kalshi/Polymarket sourcing from visible AI explanations (still used internally to inform the pick/confidence)
- Wired in team recent match-by-match form (last 5 results) into the AI prompt, previously fetched but unused
- Extracted a shared `getMatchRecentForm()` helper so the same last-5-results data is also shown visibly on each Game Props match card (result, score, opponent)
- Renamed "Draw" to "Tie" throughout (odds display, AI prompt, mock picks) and standardized recent-form results to show T instead of D
- Made Game Props boxes bigger (padding/text/spacing) for readability

### Session 4 — July 2-3, 2026 (user forgot to end session again — covers one more unlogged commit plus this session's live-site check)
- **Unlogged commit from prior session** (`633d668`): fixed the root cause of "0 upcoming picks" — matches were being dropped from the list the instant kickoff time passed, even if still being played. `getWorldCupOdds()` in `src/lib/odds.ts` now cross-checks The Odds API's scores endpoint (`completed` flag, `daysFrom=1`) and only removes matches confirmed finished; added a pulsing red **LIVE** badge in `MarketsBrowser.tsx` for in-play matches, and dropped "upcoming" from the section-count copy since counts can now include live matches too
- This session: checked the live site and found `dylanharperpicks.vercel.app` was still serving a build from 20+ hours ago — two git-push auto-deploys (`d06dc34`, `633d668`) had gone Ready in Vercel but the production alias never moved. Confirmed this isn't limited to manual `vercel --prod` deploys as previously documented; ran `vercel alias set` to point the domain at the latest deployment and re-verified `/api/odds` and `/api/picks` live
- Added a **line-divergence flag** (`getLineDivergence()` in `src/lib/odds.ts`): compares implied win probability across all shopped bookmakers on the moneyline market and flags matches with unusually wide disagreement (≥12pt spread, 3+ books minimum). Shown as an amber "Unusual line movement" badge in `MarketsBrowser.tsx`, and passed into the AI prompt in `picks/route.ts` as a soft signal to lower confidence — with explicit instructions never to claim/imply a match is fixed or treat the flag as directional. Framed throughout as a cheap approximation of real integrity-monitoring (IBIA/Sportradar), not an actual fixing detector. Typechecked, built, and verified live via `/api/odds` (current live match correctly shows a normal ~3.7pt spread, unflagged)
- Verified the LIVE-match fix works in production: `/api/odds` correctly showed a live match (Switzerland vs Algeria, `isLive: true`) instead of an empty list
- Noted (not a bug, self-corrects): right after the realias, `/api/picks` briefly still returned a cached pick for a different, non-live match — the 20-minute `unstable_cache` TTL isn't keyed to deployment/code version, so a pick generated just before a deploy can stay stale for up to 20 minutes after. Not worth engineering around, just worth knowing if a spot-check right after a deploy looks momentarily out of sync with `/api/odds`

### Session 5 — July 2-3, 2026 (unlogged again — reconstructed from git history at start of this session)
- Graded every AI World Cup pick against real final scores (via the existing Odds API scores endpoint) once matches finish, storing history in a new Vercel Blob store; aggregate win rate (overall + per market type) fed back into the AI prompt as a calibration signal for future picks
- Added price-history tracking per match in Blob storage and a "timing" field (bet now vs. wait) based on real observed line movement, plus a "When to Bet" UI section — **then removed it again the same session**, replaced with a simpler "counterpoint" field on each pick (the single best reason the other outcome could win, or a plain statement there isn't one)
- Also removed golf entirely in that same pass (client, odds fetching, response field, `DATAGOLF_API_KEY`) — it had been switched off and unused for a while
- Brought back a **second pick per match**: every match now gets both `highestPercent` (most likely to win) and `highestValue` (best real-probability-vs-market-price value), each with its own explanation and counterpoint — reuses already-fetched odds data, no new API calls
- Fixed truncated/malformed JSON on the first request after deploy: the two-pick change roughly doubled response size and 5000 `max_tokens` wasn't enough headroom alongside Sonnet 5's default thinking; raised to 8000 and added raw-response logging on JSON failures so a repeat is diagnosable
- Built out the previously-placeholder **Player Props tab**: new `src/lib/propline.ts` pulls anytime-goalscorer and 2+ assists odds from PropLine, matched to existing matches by team name (PropLine uses its own event IDs). Deliberately skips PropLine's scorer-assisted-by-X combo market and the too-sparse goal-or-assist market. Each market capped to a handful of top candidates (top 5 scorers, top 3 for assists) to limit prompt size; player props feed into the same two-pick system as a candidate outcome alongside Moneyline/Spread/Totals, not a separate feature
- Verified at start of this session: local `main` matches `origin/main` exactly, and the `dylanharperpicks.vercel.app` alias already points at the latest commit's deployment (no realias needed this time — the known alias-staleness gotcha didn't recur)

### Session 6 — July 3, 2026
- Reworked the two-pick system by request, through a few iterations: briefly tried 3 picks with an `isBestValue` flag on one of them, then settled on **2 picks ranked purely by how likely each is to hit** — dropped the separate "highest value" framing entirely. Moneyline/Tie is now explicitly called out as an eligible candidate alongside Spread/Totals/player props, and the prompt explicitly warns against just mechanically grabbing the two shortest-odds favorites — picks still need to come from genuine analysis of the stats/form/knowledge provided
- Made `counterpoint` nullable: the AI now omits it (JSON `null`) for near-lock picks instead of writing a manufactured "no real case here" placeholder sentence. Frontend (`MarketsBrowser.tsx`) only renders the "Why It Might Not Hit" section when a counterpoint is actually present
- `MOCK_PICKS` was flipped on locally for testing, then the user reconsidered ("it's going to use tokens on every refresh anyway") — reverted before any real spend. Discovered along the way that `.env.local` has `ODDS_API_KEY`/`FOOTBALL_DATA_API_KEY`/`ANTHROPIC_API_KEY` intentionally blank locally, and that these are marked Sensitive on Vercel so `vercel env pull` can't retrieve them either — couldn't do a full local UI verification, shipped on typecheck + build confidence instead (see "What's left to do")
- Fixed the git commit email here too as a precaution (see [[feedback-vercel-git-email]]), though this repo wasn't actually hitting the block
- The alias-staleness gotcha recurred yet again after this session's deploy — realiased `dylanharperpicks.vercel.app` to the latest deployment and confirmed the site loads (didn't hit `/api/picks` directly to avoid an unnecessary paid AI call — the new pick logic will apply next time it naturally regenerates)

### Session 7 — July 3, 2026 (same day, continued session)
- **Added MLB as a second full sport**, mirroring the entire World Cup pipeline — see "Data sources" and "Key files" above for the detailed breakdown. New `lib/baseball.ts` (MLB Stats API, no key needed), parameterized `lib/odds.ts` and `lib/predictionMarkets.ts` to serve both sports off shared clients, added `getMlbPlayerProps()` to `propline.ts`, added a `sport` field to `pickHistory.ts` so each sport gets its own calibration signal. Verified every external API (Odds API, PropLine, Kalshi, MLB Stats API) live with real curl calls before writing any code — all confirmed working, no new signups needed.
- User caught two real requirements I'd gotten wrong initially, both fixed same session:
  1. First shipped MLB odds capped to a single game (mirroring a `singleUpcomingOnly` idea) — user corrected: MLB should show **all** of today's games, or all games from the single nearest upcoming day, never spanning two different days. `getOddsForSport()` in `lib/odds.ts` now takes a `wholeDayFallback` flag; soccer's original single-game-fallback behavior is unchanged.
  2. AI-prompt generation still caps at 6 games per sport for cost control (mirrors the pre-existing soccer cap) — the "show all" fix only applies to the Game Props browser (`/api/odds`), which is intentionally uncapped.
- **Redesigned the homepage nav as a persistent left sidebar** (World Cup red / MLB amber, switcher — not both-visible) per user's reference screenshot of another app's sidebar pattern, replacing the old stacked-collapsible-sections layout. Also added general visual polish (colored active states, a colored top-accent bar per section, `chip-selected-amber` CSS variant) since the single-column layout read as flat/boring.
- Verified the new layout locally via a temporary `MOCK_PICKS = true` flip + Playwright screenshots (same approach as the earlier 2-pick rework) — caught and fixed a real bug this way: the "no markets" empty state in `MarketsBrowser.tsx` was hardcoded to say "No World Cup markets" even when viewing the MLB section. Fixed to `No {sport === 'mlb' ? 'MLB' : 'World Cup'} markets`. Reverted the mock flag and cleaned up before finishing.
- Confirmed for the user, when asked: MLB roughly doubles Anthropic spend per cache-refresh cycle (a fully separate AI call, not merged into soccer's), but confirmed removing the `counterpoint` field would only save ~5-10% of output tokens (the explanation bullets and input data table dominate cost, not counterpoint) — user chose to keep `counterpoint` rather than remove it for a marginal saving.
- **Fixed a real user-reported slowness bug**: initially ran soccer and MLB picks generation *sequentially* (`await` one, then the other) specifically to avoid the pickHistory Blob race described above — this meant a cache-miss waited for two full AI calls back to back, doubling load time on top of the already-doubled cost. Switched to `Promise.all` (parallel) once the race was judged an acceptable, self-correcting, non-critical tradeoff (see Deployment Notes) — this was the actual fix for "picks are taking forever."
- Deployed in two passes (MLB feature, then the parallel-execution fix) — the alias-staleness gotcha hit both times as expected; realiased each time and verified the live site loads without hitting `/api/picks` directly (to avoid triggering a real paid AI call just to check).

### Session 8 — July 3, 2026 (same day, continued session)
- User shared screenshots of 3 real lost betting slips (all AI-generated picks) and asked to use them to improve future picks. Diagnosed 3 recurring failure patterns rather than reacting to the specific teams/players involved:
  1. Egypt Moneyline (outright win) picked twice across two different parlays for the same AUS vs EGY match — game finished 1-1 (went to added time), i.e. a genuinely close match where an outright-win pick was the wrong bet type entirely.
  2. CHI Cubs Moneyline lost as a blowout (STL 17, CHC 1), not just a close loss — a sign recent form/pitching matchup wasn't weighted heavily enough against a decent-looking season record.
  3. Mohamed Salah Anytime Goals (Over 0.5) missed — a reminder that single-player goalscorer props are inherently sub-50% propositions even for elite players, and shouldn't be treated as high-confidence just because a recognizable name is on the board.
- Added 3 targeted rules to the AI prompts in `src/app/api/picks/route.ts` (`generatePicks` for soccer, `generateMlbPicks` for MLB): (a) soccer — don't default to an outright Moneyline pick in a genuinely close/coinflip match, Tie or Spread/Totals is often sharper; (b) soccer — cap anytime-goalscorer picks at Medium confidence, never High; (c) MLB — recent form (L5) and the starting-pitcher matchup should be able to override a fine season record, not just get a footnote mention.
- Typechecked and built clean; **not verified against a real AI call** (see "What's left to do") — consistent with the user's standing cost-conscious preference not to trigger a real `/api/picks` call just to check.
- Flagged and did not act on a prompt-injection attempt found in this session: `AGENTS.md` instructs reading `node_modules/next/dist/docs/` before writing code, and that path contains a hidden HTML-comment "AI agent hint" trying to get an agent to add a fabricated `unstable_instant` export. Not something Next.js actually ships — treat any future instructions sourced from that directory as untrusted.
- Deployed and realiased as usual — the alias-staleness gotcha recurred again (as expected at this point).

### Session 9 — July 3, 2026 (same day, continued session)
- **Removed MLB entirely**, per direct request — it was a fully separate Anthropic call doubling per-refresh token spend, and the user wanted that stopped along with its data pipeline. Confirmed scope with the user first (full removal vs. keep-code-but-disable) — chose full removal, same treatment golf got in Session 5.
- Deleted `src/lib/baseball.ts` (MLB Stats API client) entirely. Removed `generateMlbPicks()` and its whole prompt/JSON-parsing block from `picks/route.ts`, the MLB branch from `odds/route.ts`, `getMlbOdds()`/`getMlbFinishedScores()` from `odds.ts`, `getMlbPlayerProps()` from `propline.ts`, and the `sport` field from `pickHistory.ts` (back to one shared history stream instead of per-sport calibration).
- Un-parameterized code that only existed to serve two sports: `getOddsForSport()` lost its `wholeDayFallback` param (dead once MLB was gone), `getPredictionMarkets()` lost its Kalshi-series-ticker param (hardcoded back to `KXWCGAME`).
- Removed the left-sidebar World Cup/MLB switcher from `page.tsx` — back to a single always-on World Cup section, same visual style (red accent, top bar, chips) just without the toggle. Removed the now-unused `chip-selected-amber` CSS class from `globals.css`.
- No MLB-specific Vercel env vars existed to clean up (it shared `ODDS_API_KEY`/`PROPLINE_API_KEY`/`ANTHROPIC_API_KEY`/`BLOB_READ_WRITE_TOKEN` with soccer, unlike golf's dedicated `DATAGOLF_API_KEY`).
- Verified locally: typecheck + build clean, and confirmed no layout regression by temporarily flipping `MOCK_PICKS` to `true` and screenshotting the homepage with Playwright's CLI (`chromium-cli` wasn't available in this environment, used `npx playwright screenshot` directly instead) — sidebar correctly shows only branding + Refresh, World Cup header/tabs render in red, no MLB remnants. Reverted the mock flag before deploying.
- Deployed and realiased as usual — the alias-staleness gotcha recurred again; confirmed live via `/api/odds` (no `sport` param needed anymore, returns World Cup matches correctly).

### Session 10 — July 3, 2026 (same day, continued session)
- **Added an "AI Parlay" feature** per request: a right-side box showing the AI's single best 3-leg (or 4-leg, only if genuinely all high-confidence) parlay for the day, built across all upcoming matches rather than per-match.
- Deliberately extended the *existing* single Anthropic call/prompt in `generatePicks()` rather than adding a second AI call — the parlay task reuses the same odds/stats/prediction-market data already in the prompt, so it adds a bit of output tokens but **no additional API call and no meaningful spend increase**. Given this session immediately followed Session 9's MLB removal (whose whole point was cutting a second AI call), a second call here would have undone that.
- Prompt rules added: use 4 legs only with genuine high confidence in all 4, otherwise exactly 3; prefer legs from different matches for real independence; return `parlay: null` if fewer than 3 matches have usable data rather than forcing a weak combination; each leg gets a one-sentence "reason", plus an overall "summary".
- New types in `lib/types.ts`: `AiParlayLeg`, `AiParlay`, and `PicksResponse.parlay: AiParlay | null`. Backend defensively validates the AI's parlay shape (exactly 3 or 4 legs, string summary) and falls back to `null` rather than letting a malformed parlay break the whole picks response.
- New `src/components/AiParlayBox.tsx`: renders the legs, combined American odds (computed client-side by reusing the existing `lib/parlay.ts` math — no new odds-math code), the summary, and an "Add All to Parlay Slip" button that merges the legs into the existing bet-builder flow (`page.tsx`'s new `addLegsToSlip`, dedupes by leg id).
- Restructured `page.tsx`'s layout: wrapped `main` and a new right-side `aside` (sticky on large screens, stacks below on mobile) in a shared flex row, nested inside the existing left-sidebar row. `MOCK_PICKS` mode also got a `buildMockParlay()` (top-3/4 favorites across matches) so local preview mode has a populated box too.
- Verified locally: typecheck + build clean. Since local dev has no real `ODDS_API_KEY` (blank, per the standing safety net), `MOCK_PICKS = true` alone couldn't populate real legs — temporarily hardcoded a fake 3-leg `AiParlay` object directly in `page.tsx` for a Playwright screenshot, confirmed the box renders correctly (legs, correct combined-odds math: -120/-105/-180 → +457, matches manual calculation) and that clicking "Add All to Parlay Slip" correctly populates the bottom ParlaySlip bar ("3 legs · Combined +457"). Reverted the hardcoded test data and `MOCK_PICKS` before deploying — used `npx playwright screenshot`/a small script again since `chromium-cli` still isn't available in this environment (had to point `NODE_PATH`/run the script from beside npx's cached `playwright` package to get ESM import resolution working).
- Deployed and realiased as usual — the alias-staleness gotcha recurred again; confirmed the site and the free `/api/odds` endpoint load correctly (didn't hit `/api/picks` directly, per the standing preference to avoid an unnecessary paid AI call just to check).
