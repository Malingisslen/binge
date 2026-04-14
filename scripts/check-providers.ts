import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SWEDISH_PROVIDERS } from '../src/lib/tmdb/providers';

// Load .env.local if present (for local runs)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] ??= match[2].trim();
  }
}

const API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY;
if (!API_KEY) {
  console.error('Fel: NEXT_PUBLIC_TMDB_API_KEY saknas.');
  process.exit(2);
}

interface TMDBProviderEntry {
  provider_id: number;
  provider_name: string;
  display_priority: number;
  logo_path: string;
}

interface TMDBProviderListResponse {
  results: TMDBProviderEntry[];
}

async function fetchProviders(mediaType: 'movie' | 'tv'): Promise<TMDBProviderEntry[]> {
  const url = `https://api.themoviedb.org/3/watch/providers/${mediaType}?api_key=${API_KEY}&watch_region=SE&language=sv-SE`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB ${mediaType} providers: ${res.status} ${res.statusText}`);
  const data: TMDBProviderListResponse = await res.json();
  return data.results;
}

async function main() {
  const [movieProviders, tvProviders] = await Promise.all([
    fetchProviders('movie'),
    fetchProviders('tv'),
  ]);

  // Merge into deduplicated map, keep lowest display_priority (= most prominent)
  const tmdbMap = new Map<number, { name: string; priority: number; sources: string[] }>();

  for (const p of movieProviders) {
    const existing = tmdbMap.get(p.provider_id);
    if (existing) {
      existing.sources.push('movie');
      existing.priority = Math.min(existing.priority, p.display_priority);
    } else {
      tmdbMap.set(p.provider_id, { name: p.provider_name, priority: p.display_priority, sources: ['movie'] });
    }
  }
  for (const p of tvProviders) {
    const existing = tmdbMap.get(p.provider_id);
    if (existing) {
      existing.sources.push('tv');
      existing.priority = Math.min(existing.priority, p.display_priority);
    } else {
      tmdbMap.set(p.provider_id, { name: p.provider_name, priority: p.display_priority, sources: ['tv'] });
    }
  }

  const ourIds = new Set(SWEDISH_PROVIDERS.map(p => p.id));

  // New: in TMDB but not in our list
  const newProviders = [...tmdbMap.entries()]
    .filter(([id]) => !ourIds.has(id))
    .sort((a, b) => a[1].priority - b[1].priority);

  // Removed: in our list but not on TMDB
  const removed = SWEDISH_PROVIDERS.filter(p => !tmdbMap.has(p.id));

  // Renamed: same ID, different name
  const renamed = SWEDISH_PROVIDERS
    .filter(p => {
      const tmdb = tmdbMap.get(p.id);
      return tmdb && tmdb.name.toLowerCase() !== p.name.toLowerCase();
    })
    .map(p => ({ ours: p, tmdbName: tmdbMap.get(p.id)!.name }));

  // Report
  console.log('=== Binge Provider Sync Check ===');
  console.log(`Datum: ${new Date().toISOString().split('T')[0]}`);
  console.log(`Vår lista: ${SWEDISH_PROVIDERS.length} providers | TMDB Sverige: ${tmdbMap.size} providers`);
  console.log();

  if (newProviders.length > 0) {
    console.log(`--- NYA providers i Sverige (${newProviders.length} st, saknas hos oss) ---`);
    for (const [id, info] of newProviders) {
      const src = info.sources.join(', ');
      console.log(`  ID ${String(id).padEnd(6)} "${info.name}"  (priority: ${info.priority}, ${src})`);
    }
    console.log();
  }

  if (removed.length > 0) {
    console.log(`--- BORTTAGNA (finns hos oss, ej på TMDB) ---`);
    for (const p of removed) {
      console.log(`  ID ${String(p.id).padEnd(6)} "${p.name}"  (type: ${p.type})`);
    }
    console.log();
  }

  if (renamed.length > 0) {
    console.log(`--- NAMNBYTEN (samma ID, annat namn) ---`);
    for (const r of renamed) {
      console.log(`  ID ${String(r.ours.id).padEnd(6)} vår: "${r.ours.name}"  ->  TMDB: "${r.tmdbName}"`);
    }
    console.log();
  }

  const totalChanges = newProviders.length + removed.length + renamed.length;

  console.log('--- SAMMANFATTNING ---');
  console.log(`Nya: ${newProviders.length} | Borttagna: ${removed.length} | Namnbyten: ${renamed.length}`);

  if (totalChanges === 0) {
    console.log('Status: ALLT OK');
    process.exit(0);
  } else {
    console.log('Status: SKILLNADER HITTADE');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Scriptfel:', err.message);
  process.exit(2);
});
