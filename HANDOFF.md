# Dylan Harper's "Trust Me" Locks — Handoff

**Last updated:** July 3, 2026 (early morning)
**Project location:** `C:\Users\Navin\Desktop\sports-picks`
**Live site:** https://dylanharperpicks.vercel.app
**GitHub:** https://github.com/geenatnewin/sports-picks (connected to Vercel — push to `main` auto-deploys)

---

## What this is

A sports betting picks web app for the 2026 World Cup. Pulls real sportsbook odds (moneyline/spread/totals + PropLine player props), prediction-market probabilities (Kalshi + Polymarket), team stats, and recent match-by-match form, feeds it all to Claude, and shows **two** AI picks per match, ranked purely by how likely each is to actually hit (Moneyline/Tie, Spread, Totals, and player props are all eligible candidates — no separate "value" pick anymore, and the AI is explicitly told not to just mechanically grab the two shortest-odds favorites). Each pick has its own explanation and an optional "counterpoint" — only shown when there's a genuine, credible reason it might not hit, omitted entirely for near-locks. Also has a manual Game/Player Props browser you can tap to build a parlay, track placed slips, and a floating "My Picks" panel. Golf support was fully removed (was built but switched off, then deleted).

Branding: displayed name is **"Dylan Harper's 'Trust Me' Locks"**. The codebase/repo/folder are still named `sports-picks` — only the Vercel project itself was renamed to `dylanharperpicks`.

---

## Current mode: LIVE — real AI picks are active

`MOCK_PICKS = false` in `src/app/api/picks/route.ts`. Real Claude-generated picks are live in production. `ANTHROPIC_API_KEY` is set on Vercel (added ~July 1 night). **This now spends real Anthropic API credits on each cache-miss refresh** — see caching note below.

**Caching:** the 20-minute picks cache was rebuilt on `unstable_cache` (Next's persistent Data Cache) instead of a plain in-memory variable, because the in-memory version reset on every cold serverless instance and was silently re-billing Anthropic far more than intended. Errors are not cached, so a failed AI call retries fresh next time instead of getting stuck.

**Fixed:** matches used to disappear from the app the instant kickoff passed, which is why the site was showing "0 upcoming picks" during schedule gaps even when a match was actually being played. `getWorldCupOdds()` now cross-checks The Odds API's scores endpoint (`completed` flag) and only drops matches confirmed finished — in-play matches stay visible with a pulsing **LIVE** badge. **Verified live as of July 3, 2026 ~03:02 UTC:** `/api/odds` correctly returned a live match (Switzerland vs Algeria, kicked off 11:00 PM, `isLive: true`) instead of showing nothing.

**New: pick-accuracy tracking.** Every AI pick is graded against real final scores once a match finishes (via the existing Odds API scores endpoint) and stored in a Vercel Blob store. Aggregate win rate (overall + per market type) is fed back into the prompt as a calibration signal for future picks — no dashboard/UI for this yet, it's purely feeding the model.

**New: line-divergence flag.** `getLineDivergence()` in `src/lib/odds.ts` compares implied win probability for the same moneyline outcome across all shopped bookmakers and flags matches where the spread is unusually wide (≥12 points, needs 3+ books quoting to avoid noise on thin markets). Surfaced as an amber "Unusual line movement" badge on Game Props cards, and fed into the AI prompt as a reason to lower confidence — explicitly instructed to never claim/imply a match is fixed and to never treat it as directional. This is a cheap DIY approximation of what real integrity-monitoring services (IBIA, Sportradar) do with data this app doesn't have access to (account-level bet volume) — a soft "worth a second look" flag, not a fixing detector. Verified live: current matches show normal ~3-4pt spreads, correctly unflagged.

---

## Data sources

| Source | Used for | Auth | Notes |
|---|---|---|---|
| The Odds API | Sportsbook odds (moneyline, spread, totals) | `ODDS_API_KEY` in `.env.local` | Sources FanDuel, DraftKings, BetMGM, Caesars (`williamhill_us`), ESPN Bet — shops for the best price per outcome across all of them. Up to 10 bookmakers = 1 billing "region", so this costs the same as just using 2 books. |
| football-data.org | Team group-stage standings/form + last-5-match history | `FOOTBALL_DATA_API_KEY` | Feeds team records AND each team's actual last-5-result history (result, score, opponent) into the AI prompt. A shared `getMatchRecentForm()` helper feeds both the AI prompt and the visible Game Props card. |
| Kalshi | Prediction market win probabilities | None (public API) | Series `KXWCGAME`, one event per match, 3 binary markets (home/away/tie). Feeds the pick/confidence but the AI is now explicitly instructed not to cite Kalshi/Polymarket by name in visible explanations. |
| Polymarket | Prediction market win probabilities | None (public API) | `gamma-api.polymarket.com/public-search`, matched by team names in event title. Same "don't cite the source" rule as Kalshi. |
| PropLine | Player props (anytime goalscorer, 2+ assists) | Same shape as The Odds API | Own event IDs, matched to existing matches by team name. Capped to top 5 scorer / top 3 assist candidates per match to limit prompt size. Feeds the same two-pick system as a candidate outcome, not a separate feature. |
| Anthropic | Generates the actual pick + explanation | `ANTHROPIC_API_KEY` | **Active in production.** Prompt explicitly asks for player tendencies, tactical matchups, head-to-head/tournament history, and weighs strength-of-schedule (a close loss to an elite squad should outweigh a similar record against weak opposition). Also fed a running pick-accuracy calibration signal (see below) and instructed to lower confidence on line-divergence-flagged matches. |

Golf (DataGolf) was removed entirely in Session 5 — no longer in the codebase.

Match filtering: only shows **today's matches**, or if there are none today, just the **single next upcoming match** — nothing further out. Timezone-safe (anchored to America/New_York regardless of server timezone).

Terminology: sportsbook/UI "Draw" outcome is normalized to **"Tie"** everywhere (odds display, AI prompt, mock picks), and recent-form results show as W/L/**T** (not D) under a fixed **"L5"** header.

---

## Key files

```
src/
  app/
    api/
      picks/route.ts       ← Main logic: fetches all data, builds AI prompt, MOCK_PICKS toggle, unstable_cache-backed cache, JSON sanitizer
      odds/route.ts        ← Formats raw odds into browsable markets for the Game Props UI, includes recent-form data
    page.js/page.tsx       ← Homepage: collapsible World Cup section, Game/Player Props tabs
    globals.css            ← Theme, "3D" depth utility classes (card-elevated, chip-elevated, btn-raised, panel-elevated-*)
  components/
    MarketsBrowser.tsx     ← Per-match cards: odds + AI pick summary + L5 form chips + tap-to-open detail modal (bigger boxes as of this session)
    ParlaySlip.tsx         ← Bottom parlay builder bar, Place Bet flow
    MyPicksPanel.tsx        ← Floating button + slide-out "My Picks" drawer
    MySlips.tsx             ← Renders placed slip history (used inside MyPicksPanel)
  lib/
    odds.ts                ← Odds API client, best-price shopping, match date filtering, Draw→Tie normalization, getLineDivergence()
    soccer.ts              ← football-data.org client (standings + getTeamRecentForm + shared getMatchRecentForm helper)
    predictionMarkets.ts   ← Kalshi + Polymarket clients
    propline.ts            ← PropLine client — anytime goalscorer + 2+ assists player props, matched to matches by team name
    pickHistory.ts         ← Grades finished picks against real scores, stores/aggregates win-rate in Vercel Blob for prompt calibration
    parlay.ts              ← Parlay odds math (American ↔ decimal, payout calc), PlacedSlip type
    types.ts                ← Shared types (MatchPick, PickOption, PicksResponse, etc.)
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

- [ ] Consider adding other sports (NBA discussed but not started — would need a new stats source since football-data.org is soccer-only)
- [ ] Keep an eye on Anthropic spend now that real picks are live — the persistent cache should hold the 20-min TTL properly now, but worth spot-checking Vercel/Anthropic usage after a few days
- [ ] Watch for a repeat of the truncated-JSON issue fixed in Session 5 (max_tokens bump) now that two-pick output is even larger with player props added on top
- [ ] Haven't verified the new "2 picks ranked purely by likelihood" prompt against a real AI call yet — deployed on typecheck/build confidence only, since a real verification call costs tokens and the user preferred not to spend one just to check. Worth a spot-check next time picks are viewed live.

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
