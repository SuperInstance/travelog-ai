# Travelog.ai

Your personal AI travel companion that remembers every trip, place, and moment.

You return from a trip with hundreds of photos and scattered notes. Details fade over time—the name of that perfect hillside café, the beach where you watched sunset, the reason you laughed so hard in Porto.

This exists for that.

Travelog.ai is not a booking platform or social feed. It's a private memory bank for your travels—hosted by you, designed only to remember.

---

## What It Does

A self-hosted travel companion that tracks your journeys and learns your preferences.

- **Trip Tracking** – Plan, log, and review trips with a timeline of stays and activities
- **Place Memory** – Save restaurants, viewpoints, and museums with your ratings and notes
- **Contextual Journal** – Entries automatically attach location, weather, and mood. Full-text search across all trips
- **Personal AI Chat** – Ask questions like “what was that wine bar in Lisbon?” or “where should I go next?” based on your history
- **Tailored Suggestions** – Recommendations built from your past travels, not popular lists
- **Budget Tracking** – Log expenses by category without complexity
- **Travel Stats** – Countries visited, days traveling, most frequented place types

## Limitations

The AI only knows what you tell it. Without external data sources, it cannot suggest new places you haven’t visited or provide real-time information like opening hours.

## Architecture

- **Runtime**: Cloudflare Workers (edge deployed)
- **Storage**: Cloudflare KV
- **AI**: DeepSeek with streaming responses
- **Frontend**: Vanilla HTML/CSS/JS

## API

| Route | Method | Description |
|-------|--------|-------------|
| `/` | GET | Landing page |
| `/app.html` | GET | Main interface |
| `/api/chat` | POST | Streaming AI chat |
| `/api/trips` | GET/POST | Trip management |
| `/api/places` | GET/POST | Saved places |
| `/api/journal` | GET/POST | Journal entries |
| `/api/map` | GET | GeoJSON export |
| `/api/recommendations` | GET | Personalized suggestions |

## Quick Start

```bash
# Clone and install
git clone <repository>
npm install

# Set your DeepSeek API key
npx wrangler secret put DEEPSEEK_API_KEY

# Run locally
npm run dev

# Deploy to your Cloudflare account
npm run deploy
```

Once deployed, visit your Worker URL to start using the travelog.

---

<div>
  <p>
    Part of the <a href="https://the-fleet.casey-digennaro.workers.dev">Cocapn Fleet</a> – open-source agent runtime and fleet protocol.
  </p>
  <p>
    Attribution: Superinstance & Lucineer (DiGennaro et al.). Source: <a href="https://cocapn.ai">cocapn.ai</a>
  </p>
</div>