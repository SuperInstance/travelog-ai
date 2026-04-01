/**
 * Trip Planner — full trip lifecycle, place memory, recommendations, budget, timeline.
 *
 * Zero dependencies. Pure TypeScript data layer for Cloudflare Worker KV.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type TripStatus = 'planned' | 'active' | 'completed';
export type PlaceCategory = 'restaurant' | 'museum' | 'viewpoint' | 'hotel' | 'bar' | 'shop' | 'transport' | 'other';
export type ActivityType = 'sightseeing' | 'dining' | 'adventure' | 'relaxation' | 'culture' | 'nightlife' | 'shopping' | 'transport';

export interface DayPlan {
  date: string;            // ISO date
  activities: Activity[];
  accommodation?: Accommodation;
  notes?: string;
}

export interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  description?: string;
  time?: string;           // HH:mm
  placeRef?: string;       // PlaceMemory id
  cost?: number;
  currency?: string;
  duration?: number;       // minutes
}

export interface Accommodation {
  name: string;
  address?: string;
  checkIn?: string;
  checkOut?: string;
  cost?: number;
  currency?: string;
  notes?: string;
}

export interface Trip {
  id: string;
  destination: string;
  country?: string;
  startDate: string;
  endDate: string;
  status: TripStatus;
  coverImage?: string;
  days: DayPlan[];
  notes?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlaceMemory {
  id: string;
  tripId: string;
  name: string;
  location: { lat?: number; lng?: number; address?: string; city?: string; country?: string };
  rating: number;          // 1–5
  category: PlaceCategory;
  notes?: string;
  tags?: string[];
  visitedAt?: string;
  cost?: number;
  currency?: string;
}

export interface Expense {
  id: string;
  tripId: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  day?: number;
}

export interface TimelineEntry {
  date: string;
  tripId: string;
  destination: string;
  highlights: string[];
  status: TripStatus;
}

// ─── Trip Planner ─────────────────────────────────────────────────────────────

export class TripPlanner {
  private trips: Map<string, Trip> = new Map();
  private places: Map<string, PlaceMemory> = new Map();
  private expenses: Map<string, Expense> = new Map();

  // ── Trip CRUD ────────────────────────────────────────────────────────────

  createTrip(input: Omit<Trip, 'id' | 'createdAt' | 'updatedAt' | 'days'> & { days?: DayPlan[] }): Trip {
    const trip: Trip = {
      id: crypto.randomUUID(),
      destination: input.destination,
      country: input.country,
      startDate: input.startDate,
      endDate: input.endDate,
      status: input.status ?? 'planned',
      coverImage: input.coverImage,
      days: input.days ?? this.generateDays(input.startDate, input.endDate),
      notes: input.notes,
      tags: input.tags ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.trips.set(trip.id, trip);
    return trip;
  }

  getTrip(id: string): Trip | undefined {
    return this.trips.get(id);
  }

  listTrips(filter?: { status?: TripStatus; destination?: string }): Trip[] {
    let result = [...this.trips.values()];
    if (filter?.status) result = result.filter(t => t.status === filter.status);
    if (filter?.destination) result = result.filter(t => t.destination.toLowerCase().includes(filter.destination!.toLowerCase()));
    return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  updateTrip(id: string, patch: Partial<Omit<Trip, 'id' | 'createdAt'>>): Trip | undefined {
    const trip = this.trips.get(id);
    if (!trip) return undefined;
    Object.assign(trip, patch, { updatedAt: new Date().toISOString() });
    return trip;
  }

  deleteTrip(id: string): boolean {
    // Cascade delete places and expenses
    for (const [pid, place] of this.places) {
      if (place.tripId === id) this.places.delete(pid);
    }
    for (const [eid, exp] of this.expenses) {
      if (exp.tripId === id) this.expenses.delete(eid);
    }
    return this.trips.delete(id);
  }

  // ── Day Planning ─────────────────────────────────────────────────────────

  private generateDays(start: string, end: string): DayPlan[] {
    const days: DayPlan[] = [];
    const current = new Date(start);
    const endDate = new Date(end);
    while (current <= endDate) {
      days.push({ date: current.toISOString().split('T')[0], activities: [] });
      current.setDate(current.getDate() + 1);
    }
    return days;
  }

  addActivity(tripId: string, dayIndex: number, activity: Omit<Activity, 'id'>): Activity | undefined {
    const trip = this.trips.get(tripId);
    if (!trip || !trip.days[dayIndex]) return undefined;
    const a: Activity = { id: crypto.randomUUID(), ...activity };
    trip.days[dayIndex].activities.push(a);
    trip.updatedAt = new Date().toISOString();
    return a;
  }

  // ── Place Memory ─────────────────────────────────────────────────────────

  savePlace(input: Omit<PlaceMemory, 'id'>): PlaceMemory {
    const place: PlaceMemory = { id: crypto.randomUUID(), ...input };
    this.places.set(place.id, place);
    return place;
  }

  getPlace(id: string): PlaceMemory | undefined {
    return this.places.get(id);
  }

  listPlaces(filter?: { tripId?: string; category?: PlaceCategory; city?: string }): PlaceMemory[] {
    let result = [...this.places.values()];
    if (filter?.tripId) result = result.filter(p => p.tripId === filter.tripId);
    if (filter?.category) result = result.filter(p => p.category === filter.category);
    if (filter?.city) result = result.filter(p => p.location.city?.toLowerCase().includes(filter.city!.toLowerCase()));
    return result;
  }

  deletePlace(id: string): boolean {
    return this.places.delete(id);
  }

  // ── Budget Tracker ───────────────────────────────────────────────────────

  addExpense(input: Omit<Expense, 'id'>): Expense {
    const exp: Expense = { id: crypto.randomUUID(), ...input };
    this.expenses.set(exp.id, exp);
    return exp;
  }

  getTripBudget(tripId: string): { total: number; byCategory: Record<string, number>; currency: string; entries: Expense[] } {
    const entries = [...this.expenses.values()].filter(e => e.tripId === tripId);
    const byCategory: Record<string, number> = {};
    let total = 0;
    let currency = 'USD';
    for (const e of entries) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
      total += e.amount;
      currency = e.currency;
    }
    return { total, byCategory, currency, entries };
  }

  // ── Trip Timeline ────────────────────────────────────────────────────────

  getTimeline(): TimelineEntry[] {
    return [...this.trips.values()]
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
      .map(t => ({
        date: t.startDate,
        tripId: t.id,
        destination: t.destination,
        highlights: t.days.flatMap(d => d.activities.map(a => a.title)).slice(0, 5),
        status: t.status,
      }));
  }

  // ── Serialization (for KV) ──────────────────────────────────────────────

  serialize(): { trips: Trip[]; places: PlaceMemory[]; expenses: Expense[] } {
    return {
      trips: [...this.trips.values()],
      places: [...this.places.values()],
      expenses: [...this.expenses.values()],
    };
  }

  static deserialize(data: { trips?: Trip[]; places?: PlaceMemory[]; expenses?: Expense[] }): TripPlanner {
    const planner = new TripPlanner();
    if (data.trips) for (const t of data.trips) planner.trips.set(t.id, t);
    if (data.places) for (const p of data.places) planner.places.set(p.id, p);
    if (data.expenses) for (const e of data.expenses) planner.expenses.set(e.id, e);
    return planner;
  }
}

// ─── Recommendation Engine ────────────────────────────────────────────────────

export class RecommendationEngine {
  /**
   * Based on visited places, suggest similar categories/tags in new destinations.
   * Returns scored recommendations grouped by category.
   */
  suggest(places: PlaceMemory[], destination?: string): { category: PlaceCategory; tags: string[]; avgRating: number; count: number }[] {
    const categoryMap = new Map<PlaceCategory, { ratings: number[]; tags: Set<string> }>();

    for (const p of places) {
      const existing = categoryMap.get(p.category) ?? { ratings: [], tags: new Set<string>() };
      existing.ratings.push(p.rating);
      if (p.tags) for (const t of p.tags) existing.tags.add(t);
      if (p.notes) {
        const words = p.notes.toLowerCase().split(/\s+/);
        for (const w of words) {
          if (w.length > 4 && !['great', 'really', 'would', 'loved'].includes(w)) {
            existing.tags.add(w);
          }
        }
      }
      categoryMap.set(p.category, existing);
    }

    return [...categoryMap.entries()]
      .map(([category, data]) => ({
        category,
        tags: [...data.tags].slice(0, 10),
        avgRating: data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length,
        count: data.ratings.length,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Find places similar to a query like "restaurants like the one we loved in Lisbon".
   */
  findSimilar(places: PlaceMemory[], query: string): PlaceMemory[] {
    const q = query.toLowerCase();
    const keywords = q.split(/\s+/).filter(w => w.length > 3);

    return places
      .map(p => {
        let score = 0;
        const searchText = `${p.name} ${p.notes ?? ''} ${p.location.city ?? ''} ${p.location.country ?? ''} ${(p.tags ?? []).join(' ')}`.toLowerCase();
        for (const kw of keywords) {
          if (searchText.includes(kw)) score += 1;
        }
        score += p.rating * 0.5;
        if (q.includes('loved') || q.includes('favorite') || q.includes('best')) {
          if (p.rating >= 4) score += 2;
        }
        return { place: p, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(r => r.place);
  }
}
