# Dylan Harper's "Trust Me" Locks — Handoff

**Last updated:** July 2, 2026
**Project location:** `C:\Users\Navin\Desktop\sports-picks`
**Live site:** https://dylanharperpicks.vercel.app
**GitHub:** https://github.com/geenatnewin/sports-picks (connected to Vercel — push to `main` auto-deploys)

---

## What this is

A sports betting picks web app for the 2026 World Cup. Pulls real sportsbook odds, prediction-market probabilities (Kalshi + Polymarket), and team stats, feeds it all to Claude, and shows one "highest probability to win" pick per match with a tap-to-expand detailed breakdown. Also has a manual "Game Props" browser (moneyline/spread/totals) you can tap to build a parlay, track placed slips, and a floating "My Picks" panel.

Branding: displayed name is **"Dylan Harper's 'Trust Me' Locks"**. The codebase/repo/folder are still named `sports-picks` — only the Vercel project itself was renamed to `dylanharperpicks`.

---

## Current mode: PREVIEW (no AI tokens spent)

`MOCK_PICKS = true` in `src/app/api/picks/route.ts`. In this mode, real odds/stats/Kalshi/Polymarket data is fetched and shown (so the UI looks and feels real), but the actual pick + explanation is a fabricated placeholder built from the raw favorite, clearly labeled `[Preview]`. **No Anthropic API calls happen in this mode** — safe to refresh/reload freely.

To go live with real AI analysis:
1. Confirm `ANTHROPIC_API_KEY` in `.env.local` is a real key (it is, as of this session)
2. Flip `MOCK_PICKS` to `false` in `route.ts`
3. Add `ANTHROPIC_API_KEY` to Vercel production env vars too — **this has NOT been done**, per explicit user request to hold off. Currently the live site would show "AI analysis failed" if MOCK_PICKS were flipped off without also adding the key to Vercel.
4. Redeploy

**Heads up on latency once real mode is on:** gathering odds + stats + Kalshi + Polymarket for all matches takes ~20-30s before the AI call even starts, and the AI call itself is another 10-50s. A real refresh could take up to ~60-90s. There's a 20-minute in-memory cache on `/api/picks` so repeat refreshes in that window are instant/free.

---

## Data sources

| Source | Used for | Auth | Notes |
|---|---|---|---|
| The Odds API | Sportsbook odds (moneyline, spread, totals) | `ODDS_API_KEY` in `.env.local` | Sources FanDuel, DraftKings, BetMGM, Caesars (`williamhill_us`), ESPN Bet — shops for the best price per outcome across all of them. Up to 10 bookmakers = 1 billing "region", so this costs the same as just using 2 books. |
| football-data.org | Team group-stage standings/form | `FOOTBALL_DATA_API_KEY` | Feeds team records into the AI prompt. |
| Kalshi | Prediction market win probabilities | None (public API) | Series `KXWCGAME`, one event per match, 3 binary markets (home/away/tie). |
| Polymarket | Prediction market win probabilities | None (public API) | `gamma-api.polymarket.com/public-search`, matched by team names in event title. |
| Anthropic | Generates the actual pick + explanation | `ANTHROPIC_API_KEY` | Currently inactive (preview mode). Not yet added to Vercel prod. |
| DataGolf | Golf predictions | `DATAGOLF_API_KEY` (still placeholder) | Unused — golf is switched off (`INCLUDE_GOLF = false`). |

Match filtering: only shows **today's matches**, or if there are none today, just the **single next upcoming match** — nothing further out. Timezone-safe (anchored to America/New_York regardless of server timezone — this was a real bug that got fixed, since Vercel runs UTC).

---

## Key files

```
src/
  app/
    api/
      picks/route.ts       ← Main logic: fetches all data, builds AI prompt, MOCK_PICKS toggle, 20-min cache
      odds/route.ts        ← Formats raw odds into browsable markets for the Game Props UI
    page.js/page.tsx       ← Homepage: collapsible World Cup section, Game/Player Props tabs
    globals.css            ← Theme, "3D" depth utility classes (card-elevated, chip-elevated, btn-raised, panel-elevated-*)
  components/
    MarketsBrowser.tsx     ← Per-match cards: odds + AI pick summary + tap-to-open detail modal
    ParlaySlip.tsx         ← Bottom parlay builder bar, Place Bet flow
    MyPicksPanel.tsx        ← Floating button + slide-out "My Picks" drawer
    MySlips.tsx             ← Renders placed slip history (used inside MyPicksPanel)
  lib/
    odds.ts                ← Odds API client, best-price shopping, match date filtering
    soccer.ts              ← football-data.org client (standings)
    predictionMarkets.ts   ← Kalshi + Polymarket clients
    parlay.ts              ← Parlay odds math (American ↔ decimal, payout calc), PlacedSlip type
    types.ts                ← Shared types (MatchPick, PickOption, PicksResponse, etc.)
```

---

## Deployment notes (important)

- **Vercel project name:** `dylanharperpicks` (renamed from `sports-picks` this session)
- **Alias does NOT auto-update.** After every `vercel --prod` deploy, run:
  ```
  vercel alias set <new-deployment-url> dylanharperpicks.vercel.app
  ```
  Otherwise the live URL keeps serving the old build.
- **SSO/deployment protection was accidentally on** for a while this session, silently gating every new deployment behind a Vercel login wall. Disabled via `vercel project protection disable dylanharperpicks --sso`. If the live site ever starts redirecting to a Vercel login page again, that setting is the first thing to check.
- Production env vars currently set: `ODDS_API_KEY`, `FOOTBALL_DATA_API_KEY`, `DATAGOLF_API_KEY` (placeholder). **`ANTHROPIC_API_KEY` intentionally NOT set on Vercel yet.**

---

## What's left to do

- [ ] Activate real AI picks (flip `MOCK_PICKS`, add `ANTHROPIC_API_KEY` to Vercel) — waiting on user go-ahead
- [ ] Build out "Player Props" tab (currently just a "coming soon" placeholder)
- [ ] Consider adding other sports (NBA discussed but not started — would need a new stats source since football-data.org is soccer-only)
- [ ] Golf is fully built but switched off (`INCLUDE_GOLF = false`) — flip on if wanted, no other work needed

## Session Log

### Session 1 (initial) — June 30, 2026
- Built the full Next.js app from scratch: World Cup + golf odds, football-data.org stats, DataGolf, Claude-generated picks

### Session 2 — July 1-2, 2026 (this session, very long)
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
