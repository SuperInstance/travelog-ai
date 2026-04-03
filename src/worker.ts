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
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({ status: 'ok', repo: 'travelog-ai', timestamp: Date.now() }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }