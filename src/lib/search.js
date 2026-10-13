// Recall over the local hub. Pure Node, zero deps.
// Keyword + recency scoring over data/events.jsonl.
const fs = require('fs');
const path = require('path');

const EVENTS = path.join(__dirname, '..', '..', 'data', 'events.jsonl');

function loadEvents() {
  if (!fs.existsSync(EVENTS)) return [];
  return fs.readFileSync(EVENTS, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function tokenize(s) {
  return (s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

function search(query, { limit = 8, source = null } = {}) {
  const terms = tokenize(query);
  const events = loadEvents();
  const scored = [];
  for (const e of events) {
    if (source && e.source !== source) continue;
    const text = (e.text || '').toLowerCase();
    if (!text) continue;
    let score = 0;
    for (const t of terms) {
      if (text.includes(t)) score += 1;
    }
    if (score === 0) continue;
    // light recency boost
    const ts = e.ts ? Date.parse(e.ts) : 0;
    if (ts) score += Math.min(2, (ts / 1e13));
    scored.push({ score, e });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.e);
}

function stats() {
  const events = loadEvents();
  const bySource = {};
  for (const e of events) bySource[e.source] = (bySource[e.source] || 0) + 1;
  return { total: events.length, bySource };
}

module.exports = { search, loadEvents, stats };

if (require.main === module) {
  const q = process.argv.slice(2).join(' ');
  if (!q) { console.log(JSON.stringify(stats(), null, 2)); process.exit(0); }
  for (const e of search(q)) {
    console.log(`[${e.source}/${e.role}] ${(e.text || '').slice(0, 120).replace(/\n/g, ' ')}`);
  }
}
