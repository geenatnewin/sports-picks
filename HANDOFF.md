# SharpPicks — Handoff

**Last updated:** June 30, 2026  
**Project location:** `C:\Users\Navin\Desktop\sports-picks`

---

## What this is
A sports betting picks web app. Fetches live odds + stats, runs them through Claude AI, and shows the best bets of the day with explanations. Built in Next.js, deployable to Vercel.

**Sports covered:**
- World Cup 2026 — moneyline and spread picks (runs through July 19, 2026)
- Golf — tournament winner picks (PGA Tour events weekly)

---

## What was done this session
- Created the full Next.js project from scratch
- Built all pages, components, API routes, and data library files
- Integrated The Odds API, football-data.org, DataGolf, and Anthropic (Claude)
- Dark dashboard UI with pick cards showing odds, confidence, and AI explanation
- TypeScript — passes type check with no errors
- HANDOFF.md written

---

## What's left to do

### Immediate (required to run)
1. **Add API keys** to `.env.local` (see step-by-step below)
2. Run `npm run dev` and test at http://localhost:3000
3. Deploy to Vercel and add keys as environment variables there too

### Later
- Add more sports (MLB, NBA, NFL) when World Cup ends
- Add player props (first goalscorer, anytime scorer)
- Add a pick history log to track record over time
- Turn into a mobile app with React Native (most of this code reuses)

---

## Setup — API Keys

Open `C:\Users\Navin\Desktop\sports-picks\.env.local` and fill in:

| Key | Where to get it | Cost |
|-----|----------------|------|
| `ODDS_API_KEY` | https://the-odds-api.com | Free (500 req/month) |
| `FOOTBALL_DATA_API_KEY` | https://www.football-data.org/client/register | Free |
| `DATAGOLF_API_KEY` | https://datagolf.com/api-access | Free tier |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com | ~$5 credit lasts a long time |

After adding keys, run:
```
cd C:\Users\Navin\Desktop\sports-picks
npm run dev
```
Then open http://localhost:3000

---

## File structure

```
sports-picks/
  src/
    app/
      page.tsx              ← main dashboard UI (client component)
      globals.css           ← dark theme base styles
      api/picks/route.ts    ← backend: fetches all data + calls Claude AI
    components/
      PickCard.tsx          ← individual pick card (odds, confidence, explanation)
    lib/
      types.ts              ← shared TypeScript interfaces
      odds.ts               ← The Odds API client (WC odds + golf outrights)
      soccer.ts             ← football-data.org client (matches, team stats)
      golf.ts               ← DataGolf client (rankings, win probabilities)
  .env.local                ← API keys — NEVER commit this to GitHub
  HANDOFF.md                ← this file
```

## How picks are generated

```
Page loads → calls /api/picks
  → fetches in parallel: WC odds + WC matches + golf odds + golf stats
  → bundles everything into a prompt for Claude
  → Claude picks best bets + writes 2-3 sentence explanations
  → returns structured JSON
  → UI renders pick cards
```

Odds data is cached 30 min, golf/rankings cached 1 hour to stay within free API tiers.
