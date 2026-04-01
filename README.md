# travelog.ai

A vessel for travelers. Your personal AI travel companion that remembers every trip, every place, every restaurant.

## What it does

travelog.ai is a repo-native AI agent that becomes your personal travel guide — one that has actually been everywhere you have.

- **Trip Planner** — Full trip lifecycle with days, activities, accommodations
- **Place Memory** — Remember every restaurant, museum, viewpoint with ratings and notes
- **Travel Journal** — Date, location, content, mood, weather, tags with full-text search
- **AI Chat** — Ask "restaurants like the one we loved in Lisbon?" and get personalized answers
- **Recommendations** — Based on your travel history, discover new places you'll love
- **Budget Tracker** — Per-trip expense tracking by category
- **Travel Stats** — Countries visited, days traveling, favorite types

## Stack

- **Runtime**: Cloudflare Workers (edge)
- **Storage**: Cloudflare KV
- **AI**: DeepSeek (SSE streaming)
- **Frontend**: Single-page HTML (sky blue + earth tones)

## API

| Route | Method | Description |
|-------|--------|-------------|
| `GET /` | GET | Landing page |
| `GET /app.html` | GET | Adventure UI |
| `/api/chat` | POST | SSE streaming chat with DeepSeek |
| `/api/trips` | GET/POST | List / CRUD trips |
| `/api/places` | GET/POST | List / CRUD saved places |
| `/api/journal` | GET/POST | List / CRUD journal entries |
| `/api/map` | GET | All places for map integration |
| `/api/recommendations` | GET | AI recommendations based on history |

## Quick Start

```bash
# Install dependencies
npm install

# Set your DeepSeek API key
npx wrangler secret put DEEPSEEK_API_KEY

# Run locally
npm run dev

# Deploy to Cloudflare
npm run deploy
```

## Project Structure

```
src/
  worker.ts          # Cloudflare Worker — all API routes + SSE streaming
  trips/
    planner.ts       # Trip lifecycle, PlaceMemory, RecommendationEngine, BudgetTracker, TripTimeline
  journal/
    writer.ts        # JournalEntry, PhotoAssociation, TravelStats, SearchableHistory
public/
  app.html           # Adventure UI — sky blue, earth brown, warm cream
```

## Design

Sky blue `#0EA5E9` meets earth brown `#92400E` on warm cream `#FFFBF0`. Adventure aesthetic with trip cards, place pins, journal timeline, and an AI chat that knows your travel history.

---

Built with [cocapn](https://github.com/cocapn) — the repo IS the agent.
