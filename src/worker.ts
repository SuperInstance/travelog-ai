/**
 * travelog.ai — Cloudflare Worker
 *
 * API Routes:
 *   POST /api/chat        — SSE streaming with DeepSeek
 *   GET/POST /api/trips   — CRUD trips
 *   GET/POST /api/places  — save/list places
 *   GET/POST /api/journal — travel journal entries
 *   GET    /api/map       — places visited (for map)
 *   GET    /api/recommendations — based on history
 *   GET    /              — landing page
 *
 * Secrets: DEEPSEEK_API_KEY
 * KV:      TRAVELOG_KV
 */

import { TripPlanner, RecommendationEngine } from './trips/planner';
import { JournalWriter } from './journal/writer';
import type { Trip, PlaceMemory, JournalEntry } from './trips/planner';

// ─── Env ──────────────────────────────────────────────────────────────────────

interface Env {
  DEEPSEEK_API_KEY: string;
  TRAVELOG_KV: KVNamespace;
}

// ─── KV Helpers ───────────────────────────────────────────────────────────────

const KV_DATA_KEY = 'travelog:data';

async function loadData(kv: KVNamespace): Promise<{ planner: TripPlanner; journal: JournalWriter }> {
  const raw = await kv.get(KV_DATA_KEY);
  if (!raw) return { planner: new TripPlanner(), journal: new JournalWriter() };
  try {
    const data = JSON.parse(raw) as {
      trips?: Trip[]; places?: PlaceMemory[]; expenses?: unknown[];
      entries?: JournalEntry[]; photos?: unknown[];
    };
    return {
      planner: TripPlanner.deserialize({ trips: data.trips, places: data.places, expenses: data.expenses as any[] }),
      journal: JournalWriter.deserialize({ entries: data.entries, photos: data.photos as any[] }),
    };
  } catch {
    return { planner: new TripPlanner(), journal: new JournalWriter() };
  }
}

async function saveData(kv: KVNamespace, planner: TripPlanner, journal: JournalWriter): Promise<void> {
  const p = planner.serialize();
  const j = journal.serialize();
  await kv.put(KV_DATA_KEY, JSON.stringify({ ...p, ...j }));
}

// ─── Response Helpers ─────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function html(content: string): Response {
  return new Response(content, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ─── Chat System Prompt ───────────────────────────────────────────────────────

function buildSystemPrompt(planner: TripPlanner, journal: JournalWriter): string {
  const trips = planner.listTrips();
  const places = planner.listPlaces();
  const recentEntries = journal.listEntries().slice(0, 10);
  const stats = journal.computeStats({
    totalTrips: trips.length,
    completedTrips: trips.filter(t => t.status === 'completed').length,
    activeTrips: trips.filter(t => t.status === 'active').length,
    placesCount: places.length,
  });

  return `You are the cocapn of travelog.ai — a personal travel companion that remembers every trip, every place, every restaurant.

## Traveler Profile
- Countries visited: ${stats.countriesVisited}
- Cities visited: ${stats.citiesVisited}
- Days traveling: ${stats.totalDaysTraveling}
- Total trips: ${stats.totalTrips} (${stats.completedTrips} completed, ${stats.activeTrips} active)
- Places saved: ${stats.placesVisited}
- Journal entries: ${stats.journalEntries}
- Favorite mood: ${stats.favoriteMood ?? 'not yet determined'}

## Trips
${trips.map(t => `- ${t.destination} (${t.startDate} → ${t.endDate}) [${t.status}]`).join('\n') || 'No trips yet.'}

## Saved Places
${places.slice(0, 30).map(p => `- ${p.name} (${p.category}, ${p.rating}/5) in ${p.location.city ?? 'unknown'} — ${p.notes ?? ''}`).join('\n') || 'No places saved yet.'}

## Recent Journal
${recentEntries.map(e => `- ${e.date} ${e.location.city ?? ''}: ${(e.content ?? '').slice(0, 120)}`).join('\n') || 'No journal entries yet.'}

Be warm, knowledgeable, and specific. Reference their actual travel history. When asked about recommendations, base suggestions on their preferences and past experiences. Help them plan, remember, and discover.`;
}

// ─── SSE Chat Streaming ───────────────────────────────────────────────────────

async function handleChat(request: Request, env: Env): Promise<Response> {
  const { message } = await request.json() as { message: string };
  if (!message) return json({ error: 'message is required' }, 400);

  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) return json({ error: 'DEEPSEEK_API_KEY not configured' }, 500);

  const { planner, journal } = await loadData(env.TRAVELOG_KV);
  const systemPrompt = buildSystemPrompt(planner, journal);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: message },
            ],
            stream: true,
          }),
        });

        if (!response.ok) {
          const err = await response.text();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err })}\n\n`));
          controller.close();
          return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                continue;
              }
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                }
              } catch { /* skip malformed chunks */ }
            }
          }
        }
      } catch (err: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ─── API Route Handlers ───────────────────────────────────────────────────────

async function handleTrips(request: Request, kv: KVNamespace): Promise<Response> {
  const { planner, journal } = await loadData(kv);

  if (request.method === 'GET') {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', repo: 'travelog-ai', timestamp: Date.now() }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    const status = url.searchParams.get('status') as any;
    const destination = url.searchParams.get('destination') ?? undefined;
    return json(planner.listTrips({ status, destination }));
  }

  if (request.method === 'POST') {
    const body = await request.json() as any;
    const action = body.action ?? 'create';

    if (action === 'create') {
      const trip = planner.createTrip(body);
      await saveData(kv, planner, journal);
      return json(trip, 201);
    }

    if (action === 'update') {
      const { id, ...patch } = body;
      if (!id) return json({ error: 'id required' }, 400);
      const trip = planner.updateTrip(id, patch);
      if (!trip) return json({ error: 'trip not found' }, 404);
      await saveData(kv, planner, journal);
      return json(trip);
    }

    if (action === 'delete') {
      const { id } = body;
      if (!id) return json({ error: 'id required' }, 400);
      planner.deleteTrip(id);
      await saveData(kv, planner, journal);
      return json({ ok: true });
    }

    return json({ error: 'unknown action' }, 400);
  }

  return json({ error: 'method not allowed' }, 405);
}

async function handlePlaces(request: Request, kv: KVNamespace): Promise<Response> {
  const { planner, journal } = await loadData(kv);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    return json(planner.listPlaces({
      tripId: url.searchParams.get('tripId') ?? undefined,
      category: url.searchParams.get('category') as any,
      city: url.searchParams.get('city') ?? undefined,
    }));
  }

  if (request.method === 'POST') {
    const body = await request.json() as any;
    const action = body.action ?? 'create';

    if (action === 'create') {
      const place = planner.savePlace(body);
      await saveData(kv, planner, journal);
      return json(place, 201);
    }

    if (action === 'delete') {
      planner.deletePlace(body.id);
      await saveData(kv, planner, journal);
      return json({ ok: true });
    }

    return json({ error: 'unknown action' }, 400);
  }

  return json({ error: 'method not allowed' }, 405);
}

async function handleJournal(request: Request, kv: KVNamespace): Promise<Response> {
  const { planner, journal } = await loadData(kv);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'search') {
      const q = url.searchParams.get('q') ?? '';
      return json(journal.search(q));
    }

    if (action === 'stats') {
      const trips = planner.listTrips();
      return json(journal.computeStats({
        totalTrips: trips.length,
        completedTrips: trips.filter(t => t.status === 'completed').length,
        activeTrips: trips.filter(t => t.status === 'active').length,
        placesCount: planner.listPlaces().length,
      }));
    }

    return json(journal.listEntries({
      tripId: url.searchParams.get('tripId') ?? undefined,
      city: url.searchParams.get('city') ?? undefined,
      mood: url.searchParams.get('mood') as any,
      dateFrom: url.searchParams.get('dateFrom') ?? undefined,
      dateTo: url.searchParams.get('dateTo') ?? undefined,
    }));
  }

  if (request.method === 'POST') {
    const body = await request.json() as any;
    const action = body.action ?? 'create';

    if (action === 'create') {
      const entry = journal.createEntry(body);
      await saveData(kv, planner, journal);
      return json(entry, 201);
    }

    if (action === 'update') {
      const { id, ...patch } = body;
      if (!id) return json({ error: 'id required' }, 400);
      const entry = journal.updateEntry(id, patch);
      if (!entry) return json({ error: 'entry not found' }, 404);
      await saveData(kv, planner, journal);
      return json(entry);
    }

    if (action === 'delete') {
      journal.deleteEntry(body.id);
      await saveData(kv, planner, journal);
      return json({ ok: true });
    }

    return json({ error: 'unknown action' }, 400);
  }

  return json({ error: 'method not allowed' }, 405);
}

async function handleMap(kv: KVNamespace): Promise<Response> {
  const { planner } = await loadData(kv);
  const places = planner.listPlaces();
  return json(places.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    rating: p.rating,
    location: p.location,
    tripId: p.tripId,
    notes: p.notes,
    tags: p.tags,
  })));
}

async function handleRecommendations(kv: KVNamespace): Promise<Response> {
  const { planner } = await loadData(kv);
  const engine = new RecommendationEngine();
  const suggestions = engine.suggest(planner.listPlaces());
  return json(suggestions);
}

// ─── Worker Export ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    try {
      // API routes
      if (path === '/api/chat' && request.method === 'POST') {
        return await handleChat(request, env);
      }
      if (path === '/api/trips') {
        return await handleTrips(request, env.TRAVELOG_KV);
      }
      if (path === '/api/places') {
        return await handlePlaces(request, env.TRAVELOG_KV);
      }
      if (path === '/api/journal') {
        return await handleJournal(request, env.TRAVELOG_KV);
      }
      if (path === '/api/map') {
        return await handleMap(env.TRAVELOG_KV);
      }
      if (path === '/api/recommendations') {
        const { planner } = await loadData(env.TRAVELOG_KV);
        const engine = new RecommendationEngine();
        return json(engine.suggest(planner.listPlaces()));
      }

      // Landing page
      if (path === '/' || path === '/index.html') {

  if (path === '/api/efficiency' && request.method === 'GET') {    return new Response(JSON.stringify({ totalCached: 0, totalHits: 0, cacheHitRate: 0, tokensSaved: 0, repo: 'travelog-ai', timestamp: Date.now() }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });  }
        const htmlContent = await env.TRAVELOG_KV.get('travelog:landing', 'text');
        if (htmlContent) return html(htmlContent);
        // Serve from bundled asset
        return html(getLandingPage());
      }

      return json({ error: 'not found' }, 404);
    } catch (err: any) {
      return json({ error: err.message }, 500);
    }
  },
};

// ─── Landing Page ─────────────────────────────────────────────────────────────

function getLandingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>travelog.ai</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #FFFBF0; color: #1C1917; }
  .hero { background: linear-gradient(135deg, #0EA5E9 0%, #38BDF8 50%, #7DD3FC 100%); padding: 4rem 2rem; text-align: center; color: white; }
  .hero h1 { font-size: 3rem; font-weight: 800; margin-bottom: 0.5rem; }
  .hero p { font-size: 1.25rem; opacity: 0.9; max-width: 600px; margin: 0 auto 2rem; }
  .hero a { display: inline-block; background: #92400E; color: white; padding: 0.75rem 2rem; border-radius: 9999px; text-decoration: none; font-weight: 600; font-size: 1.1rem; }
  .hero a:hover { background: #78350F; }
  .features { max-width: 900px; margin: 3rem auto; padding: 0 2rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 2rem; }
  .feature { background: white; border-radius: 12px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .feature h3 { color: #0EA5E9; margin-bottom: 0.5rem; }
  .feature p { color: #57534E; line-height: 1.6; }
  footer { text-align: center; padding: 2rem; color: #A8A29E; font-size: 0.9rem; }
</style>
</head>
<body>
  <div class="hero">
    <h1>travelog.ai</h1>
    <p>Your personal travel companion that remembers every trip, every place, every restaurant you've ever visited.</p>
    <a href="/app.html">Open Your Travel Log</a>
  </div>
  <div class="features">
    <div class="feature"><h3>Trip Planner</h3><p>Plan full trip lifecycles with days, activities, and accommodations.</p></div>
    <div class="feature"><h3>Place Memory</h3><p>Remember every restaurant, museum, and viewpoint with ratings and notes.</p></div>
    <div class="feature"><h3>Travel Journal</h3><p>Write entries with mood, weather, and photos. Full-text search across all travels.</p></div>
    <div class="feature"><h3>AI Companion</h3><p>Ask: "restaurants like the one we loved in Lisbon?" Get personalized answers.</p></div>
    <div class="feature"><h3>Recommendations</h3><p>Based on your travel history, discover new places you'll love.</p></div>
    <div class="feature"><h3>Budget Tracker</h3><p>Track expenses per trip, per category. Know where your money goes.</p></div>
  </div>
  <footer>travelog.ai &mdash; a vessel for travelers. Built with love.</footer>
</body>
</html>`;
}
