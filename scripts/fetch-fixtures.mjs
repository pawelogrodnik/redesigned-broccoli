import fs from 'node:fs/promises';

const TOKEN = process.env.FD_TOKEN;
const API = 'https://api.football-data.org/v4';
const COMPS = [
  'CL',
  // 'EL', 'ECL',
  //   'SA',
  //   'PL',
  //   'BL1',
  //   'PD',
  //   'FL1',
];
const VENUE_CACHE_FILE = 'data/venues.json';
const OUT_DIR = 'data';
// -----------------------------------------------------
// Helpers
// -----------------------------------------------------
async function fd(path) {
  const r = await fetch(`${API}${path}`, {
    headers: { 'X-Auth-Token': TOKEN },
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => '');
    throw new Error(`${r.status} ${r.statusText} for ${path} :: ${msg}`);
  }
  return r.json();
}

const simplify = (m) => ({
  id: m.id,
  utcDate: m.utcDate,
  competition: { code: m.competition?.code, name: m.competition?.name },
  stage: m.stage,
  matchday: m.matchday ?? null,
  homeTeam: {
    id: m.homeTeam.id,
    name: m.homeTeam.name,
    crest: m.homeTeam.crest,
  },
  awayTeam: {
    id: m.awayTeam.id,
    name: m.awayTeam.name,
    crest: m.awayTeam.crest,
  },
  area: m.area,
  lastUpdated: m.lastUpdated,
});

// -----------------------------------------------------
// Venue cache helpers
// -----------------------------------------------------
async function loadVenueCache() {
  try {
    return JSON.parse(await fs.readFile(VENUE_CACHE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

async function saveVenueCache(cache) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(VENUE_CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function geocode(team, competition, country) {
  const q = encodeURIComponent(
    `${team.name} ${competition} stadium ${country ?? ''}`
  );
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'uefa-fixtures/1.0 (your-email@example.com)' },
  });
  if (!res.ok) return null;

  const data = await res.json();
  if (!data.length) return null;

  const { lat, lon, display_name } = data[0];
  return {
    name: display_name,
    lat: +lat,
    lng: +lon,
    updatedAt: new Date().toISOString(),
  };
}

async function enrichVenues(matches) {
  const cache = await loadVenueCache();
  let updated = false;

  for (const m of matches) {
    const id = m.homeTeam.id;
    const comp = m.competition.code;
    if (cache[id]?.[comp]) continue; // already cached

    console.log(`🌍 Geocoding ${m.homeTeam.name} (${comp})...`);
    const geo = await geocode(m.homeTeam, comp, m.area?.name);
    if (geo) {
      cache[id] = cache[id] || {};
      cache[id][comp] = geo;
      updated = true;
    } else {
      console.warn(`⚠️ No result for ${m.homeTeam.name} (${comp})`);
    }
    await new Promise((r) => setTimeout(r, 1100)); // rate limit
  }

  if (updated) await saveVenueCache(cache);
  return cache;
}

// -----------------------------------------------------
// Main flow
// -----------------------------------------------------
async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  let allMatches = [];

  for (const comp of COMPS) {
    try {
      const data = await fd(`/competitions/${comp}/matches?status=SCHEDULED`);
      const matches = (data.matches ?? []).map(simplify);
      allMatches.push(...matches);
      await fs.writeFile(
        `${OUT_DIR}/fixtures_${comp}.json`,
        JSON.stringify(matches, null, 2)
      );
      console.log(`✅ Saved ${matches.length} matches for ${comp}`);
    } catch (err) {
      console.error(`❌ Failed fetching ${comp}: ${err.message}`);
      await fs.writeFile(`${OUT_DIR}/fixtures_${comp}.json`, '[]');
    }
  }

  // add coords for missing venues
  const venues = await enrichVenues(allMatches);

  // inject coords into fixture files
  for (const comp of COMPS) {
    const file = `${OUT_DIR}/fixtures_${comp}.json`;
    let matches = [];
    try {
      matches = JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch {}
    for (const m of matches) {
      const v = venues[m.homeTeam.id]?.[comp];
      if (v) {
        m.homeTeam.lat = v.lat;
        m.homeTeam.lng = v.lng;
      }
    }
    await fs.writeFile(file, JSON.stringify(matches, null, 2));
  }

  console.log('🏁 Done.');
}

run().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
