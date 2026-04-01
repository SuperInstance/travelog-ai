/**
 * Journal Writer — travel journal entries, photo association, stats, full-text search.
 *
 * Zero dependencies. Pure TypeScript data layer for Cloudflare Worker KV.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Mood = 'amazing' | 'happy' | 'neutral' | 'tired' | 'stressed' | 'sad';
export type Weather = 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'stormy' | 'hot' | 'cold' | 'windy';

export interface JournalEntry {
  id: string;
  tripId?: string;
  date: string;            // ISO date
  location: { lat?: number; lng?: number; address?: string; city?: string; country?: string };
  title?: string;
  content: string;
  mood?: Mood;
  weather?: Weather;
  tags?: string[];
  photoIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Photo {
  id: string;
  url: string;
  caption?: string;
  placeId?: string;
  journalEntryId?: string;
  takenAt?: string;
  location?: { lat?: number; lng?: number };
}

export interface TravelStats {
  countriesVisited: number;
  citiesVisited: number;
  totalDaysTraveling: number;
  totalTrips: number;
  completedTrips: number;
  activeTrips: number;
  placesVisited: number;
  journalEntries: number;
  favoriteMood: Mood | null;
  topCategories: { category: string; count: number }[];
  topCountries: { country: string; count: number }[];
}

export interface SearchResult {
  entry: JournalEntry;
  score: number;
  matches: string[];
}

// ─── Journal Writer ───────────────────────────────────────────────────────────

export class JournalWriter {
  private entries: Map<string, JournalEntry> = new Map();
  private photos: Map<string, Photo> = new Map();

  // ── Entry CRUD ───────────────────────────────────────────────────────────

  createEntry(input: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'>): JournalEntry {
    const entry: JournalEntry = {
      id: crypto.randomUUID(),
      tripId: input.tripId,
      date: input.date,
      location: input.location,
      title: input.title,
      content: input.content,
      mood: input.mood,
      weather: input.weather,
      tags: input.tags ?? [],
      photoIds: input.photoIds ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  getEntry(id: string): JournalEntry | undefined {
    return this.entries.get(id);
  }

  listEntries(filter?: { tripId?: string; city?: string; mood?: Mood; dateFrom?: string; dateTo?: string }): JournalEntry[] {
    let result = [...this.entries.values()];
    if (filter?.tripId) result = result.filter(e => e.tripId === filter.tripId);
    if (filter?.city) result = result.filter(e => e.location.city?.toLowerCase().includes(filter.city!.toLowerCase()));
    if (filter?.mood) result = result.filter(e => e.mood === filter.mood);
    if (filter?.dateFrom) result = result.filter(e => e.date >= filter.dateFrom!);
    if (filter?.dateTo) result = result.filter(e => e.date <= filter.dateTo!);
    return result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  updateEntry(id: string, patch: Partial<Omit<JournalEntry, 'id' | 'createdAt'>>): JournalEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
    return entry;
  }

  deleteEntry(id: string): boolean {
    return this.entries.delete(id);
  }

  // ── Photo Association ────────────────────────────────────────────────────

  addPhoto(input: Omit<Photo, 'id'>): Photo {
    const photo: Photo = { id: crypto.randomUUID(), ...input };
    this.photos.set(photo.id, photo);
    // Link to journal entry
    if (photo.journalEntryId) {
      const entry = this.entries.get(photo.journalEntryId);
      if (entry && !entry.photoIds?.includes(photo.id)) {
        entry.photoIds = [...(entry.photoIds ?? []), photo.id];
      }
    }
    return photo;
  }

  getPhotosForEntry(entryId: string): Photo[] {
    return [...this.photos.values()].filter(p => p.journalEntryId === entryId);
  }

  // ── Travel Stats ─────────────────────────────────────────────────────────

  computeStats(tripStats?: { totalTrips: number; completedTrips: number; activeTrips: number; placesCount: number }): TravelStats {
    const entries = [...this.entries.values()];
    const countries = new Set<string>();
    const cities = new Set<string>();
    const moodCounts = new Map<Mood, number>();

    for (const e of entries) {
      if (e.location.country) countries.add(e.location.country);
      if (e.location.city) cities.add(e.location.city);
      if (e.mood) moodCounts.set(e.mood, (moodCounts.get(e.mood) ?? 0) + 1);
    }

    // Count unique traveling days
    const travelDates = new Set(entries.map(e => e.date));

    // Most common mood
    let favoriteMood: Mood | null = null;
    let maxMood = 0;
    for (const [mood, count] of moodCounts) {
      if (count > maxMood) { maxMood = count; favoriteMood = mood; }
    }

    // Top countries
    const countryCounts = new Map<string, number>();
    for (const e of entries) {
      if (e.location.country) {
        countryCounts.set(e.location.country, (countryCounts.get(e.location.country) ?? 0) + 1);
      }
    }
    const topCountries = [...countryCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([country, count]) => ({ country, count }));

    return {
      countriesVisited: countries.size,
      citiesVisited: cities.size,
      totalDaysTraveling: travelDates.size,
      totalTrips: tripStats?.totalTrips ?? 0,
      completedTrips: tripStats?.completedTrips ?? 0,
      activeTrips: tripStats?.activeTrips ?? 0,
      placesVisited: tripStats?.placesCount ?? 0,
      journalEntries: entries.length,
      favoriteMood,
      topCategories: [],
      topCountries,
    };
  }

  // ── Full-Text Search ─────────────────────────────────────────────────────

  search(query: string): SearchResult[] {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return [];

    return [...this.entries.values()]
      .map(entry => {
        const searchText = [
          entry.title ?? '',
          entry.content,
          entry.location.city ?? '',
          entry.location.country ?? '',
          ...(entry.tags ?? []),
          entry.mood ?? '',
          entry.weather ?? '',
        ].join(' ').toLowerCase();

        let score = 0;
        const matches: string[] = [];

        for (const term of terms) {
          if (searchText.includes(term)) {
            score += 1;
            matches.push(term);
          }
        }

        return { entry, score, matches };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  // ── Serialization ────────────────────────────────────────────────────────

  serialize(): { entries: JournalEntry[]; photos: Photo[] } {
    return {
      entries: [...this.entries.values()],
      photos: [...this.photos.values()],
    };
  }

  static deserialize(data: { entries?: JournalEntry[]; photos?: Photo[] }): JournalWriter {
    const writer = new JournalWriter();
    if (data.entries) for (const e of data.entries) writer.entries.set(e.id, e);
    if (data.photos) for (const p of data.photos) writer.photos.set(p.id, p);
    return writer;
  }
}
