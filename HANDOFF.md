# Dylan Harper's "Trust Me" Locks — Handoff

**Last updated:** July 3, 2026 (early morning)
**Project location:** `C:\Users\Navin\Desktop\sports-picks`
**Live site:** https://dylanharperpicks.vercel.app
**GitHub:** https://github.com/geenatnewin/sports-picks (connected to Vercel — push to `main` auto-deploys)

---

## What this is

A sports betting picks web app for the 2026 World Cup. Pulls real sportsbook odds, prediction-market probabilities (Kalshi + Polymarket), team stats, and recent match-by-match form, feeds it all to Claude, and shows one "highest probability to win" pick per match with a tap-to-expand detailed breakdown. Also has a manual "Game Props" browser (moneyline/spread/totals) you can tap to build a parlay, track placed slips, and a floating "My Picks" panel.

Branding: displayed name is **"Dylan Harper's 'Trust Me' Locks"**. The codebase/repo/folder are still named `sports-picks` — only the Vercel project itself was renamed to `dylanharperpicks`.

---

## Current mode: LIVE — real AI picks are active

`MOCK_PICKS = false` in `src/app/api/picks/route.ts`. Real Claude-generated picks are live in production. `ANTHROPIC_API_KEY` is set on Vercel (added ~July 1 night). **This now spends real Anthropic API credits on each cache-miss refresh** — see caching note below.

**Caching:** the 20-minute picks cache was rebuilt on `unstable_cache` (Next's persistent Data Cache) instead of a plain in-memory variable, because the in-memory version reset on every cold serverless instance and was silently re-billing Anthropic far more than intended. Errors are not cached, so a failed AI call retries fresh next time instead of getting stuck.

**Fixed:** matches used to disappear from the app the instant kickoff passed, which is why the site was showing "0 upcoming picks" during schedule gaps even when a match was actually being played. `getWorldCupOdds()` now cross-checks The Odds API's scores endpoint (`completed` flag) and only drops matches confirmed finished — in-play matches stay visible with a pulsing **LIVE** badge. **Verified live as of July 3, 2026 ~03:02 UTC:** `/api/odds` correctly returned a live match (Switzerland vs Algeria, kicked off 11:00 PM, `isLive: true`) instead of showing nothing.

**New: line-divergence flag.** `getLineDivergence()` in `src/lib/odds.ts` compares implied win probability for the same moneyline outcome across all shopped bookmakers and flags matches where the spread is unusually wide (≥12 points, needs 3+ books quoting to avoid noise on thin markets). Surfaced as an amber "Unusual line movement" badge on Game Props cards, and fed into the AI prompt as a reason to lower confidence — explicitly instructed to never claim/imply a match is fixed and to never treat it as directional. This is a cheap DIY approximation of what real integrity-monitoring services (IBIA, Sportradar) do with data this app doesn't have access to (account-level bet volume) — a soft "worth a second look" flag, not a fixing detector. Verified live: current matches show normal ~3-4pt spreads, correctly unflagged.

---

## Data sources

| Source | Used for | Auth | Notes |
|---|---|---|---|
| The Odds API | Sportsbook odds (moneyline, spread, totals) | `ODDS_API_KEY` in `.env.local` | Sources FanDuel, DraftKings, BetMGM, Caesars (`williamhill_us`), ESPN Bet — shops for the best price per outcome across all of them. Up to 10 bookmakers = 1 billing "region", so this costs the same as just using 2 books. |
| football-data.org | Team group-stage standings/form + last-5-match history | `FOOTBALL_DATA_API_KEY` | Feeds team records AND each team's actual last-5-result history (result, score, opponent) into the AI prompt. A shared `getMatchRecentForm()` helper feeds both the AI prompt and the visible Game Props card. |
| Kalshi | Prediction market win probabilities | None (public API) | Series `KXWCGAME`, one event per match, 3 binary markets (home/away/tie). Feeds the pick/confidence but the AI is now explicitly instructed not to cite Kalshi/Polymarket by name in visible explanations. |
| Polymarket | Prediction market win probabilities | None (public API) | `gamma-api.polymarket.com/public-search`, matched by team names in event title. Same "don't cite the source" rule as Kalshi. |
| Anthropic | Generates the actual pick + explanation | `ANTHROPIC_API_KEY` | **Active in production.** Prompt explicitly asks for player tendencies, tactical matchups, head-to-head/tournament history, and weighs strength-of-schedule (a close loss to an elite squad should outweigh a similar record against weak opposition). |
| DataGolf | Golf predictions | `DATAGOLF_API_KEY` (still placeholder) | Unused — golf is switched off (`INCLUDE_GOLF = false`). |

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
    odds.ts                ← Odds API client, best-price shopping, match date filtering, Draw→Tie normalization
    soccer.ts              ← football-data.org client (standings + getTeamRecentForm + shared getMatchRecentForm helper)
    predictionMarkets.ts   ← Kalshi + Polymarket clients
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
- Production env vars currently set: `ODDS_API_KEY`, `FOOTBALL_DATA_API_KEY`, `DATAGOLF_API_KEY` (placeholder), **`ANTHROPIC_API_KEY` (now set — real AI picks are live)**.

---

## What's left to do

- [ ] Build out "Player Props" tab (currently just a "coming soon" placeholder)
- [ ] Consider adding other sports (NBA discussed but not started — would need a new stats source since football-data.org is soccer-only)
- [ ] Golf is fully built but switched off (`INCLUDE_GOLF = false`) — flip on if wanted, no other work needed
- [ ] Keep an eye on Anthropic spend now that real picks are live — the persistent cache should hold the 20-min TTL properly now, but worth spot-checking Vercel/Anthropic usage after a few days

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
