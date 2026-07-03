# Dylan Harper's "Trust Me" Locks — Handoff

**Last updated:** July 2, 2026
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

**As observed live on July 2, 2026:** the World Cup section shows **"0 upcoming picks."** This is expected behavior, not a bug — the match-date filter only shows today's matches, or if none today, the single next upcoming match; there's apparently a gap in the tournament schedule right now. Worth a quick sanity check next session that this flips back on once matches resume. The "My Picks" panel correctly shows its empty state ("No slips placed yet").

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
- **Alias does NOT auto-update.** After every `vercel --prod` deploy, run:
  ```
  vercel alias set <new-deployment-url> dylanharperpicks.vercel.app
  ```
  Otherwise the live URL keeps serving the old build.
- **SSO/deployment protection** was accidentally on for a while previously, silently gating every new deployment behind a Vercel login wall. Disabled via `vercel project protection disable dylanharperpicks --sso`. If the live site ever starts redirecting to a Vercel login page again, that setting is the first thing to check.
- Production env vars currently set: `ODDS_API_KEY`, `FOOTBALL_DATA_API_KEY`, `DATAGOLF_API_KEY` (placeholder), **`ANTHROPIC_API_KEY` (now set — real AI picks are live)**.

---

## What's left to do

- [ ] Confirm picks repopulate once the World Cup schedule has a match today/next-up again (site currently shows "0 upcoming picks" — expected given the schedule gap, but worth eyeballing)
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
