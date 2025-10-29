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

async function fd(path) {
  const r = await fetch(`${API}${path}`, {
    headers: { 'X-Auth-Token': TOKEN },
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${path}`);
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
  lastUpdated: m.lastUpdated,
});

async function run() {
  await fs.mkdir('data', { recursive: true });
  for (const c of COMPS) {
    try {
      const data = await fd(`/competitions/${c}/matches?status=SCHEDULED`);
      const out = (data.matches ?? [])
        .filter((match) => match.homeTeam.name)
        .map(simplify)
        .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
      await fs.writeFile(
        `data/fixtures_${c}.json`,
        JSON.stringify(out, null, 2)
      );
      console.log(`dist/fixtures_${c}.json (${out.length})`);
    } catch (err) {
      console.error(err);
    }
  }
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
