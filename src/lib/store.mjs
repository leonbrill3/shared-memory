// Shared-memory facts store. One append-only file of durable facts, with
// dedupe + supersede so it stays small and current (the "notebook").
// Plain Node, JSON-lines on disk. This is the single source of truth that
// Muse, Claude, and ChatGPT all read and write through the MCP server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const MEM = path.join(DATA_DIR, 'memory.jsonl');

fs.mkdirSync(DATA_DIR, { recursive: true });

function nowISO() { return new Date().toISOString(); }

function readAll() {
  if (!fs.existsSync(MEM)) return [];
  return fs.readFileSync(MEM, 'utf8')
    .split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function writeAll(facts) {
  fs.writeFileSync(MEM, facts.map((f) => JSON.stringify(f)).join('\n') + (facts.length ? '\n' : ''));
}

function tokenize(s) {
  return new Set(((s || '').toLowerCase().match(/[a-z0-9]+/g) || []));
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Add a fact. If a near-identical fact exists, supersede it (update in place)
// rather than appending a duplicate. Returns {status, fact}.
export function addFact({ text, tags = [], source = 'unknown' }) {
  text = (text || '').trim();
  if (!text) throw new Error('text is required');
  const facts = readAll();
  const incoming = tokenize(text);

  let bestIdx = -1, bestScore = 0;
  for (let i = 0; i < facts.length; i++) {
    const s = jaccard(incoming, tokenize(facts[i].text));
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  }

  // Exact/near-exact → it's already known, nothing changed.
  if (bestScore >= 0.9) {
    return { status: 'duplicate', fact: facts[bestIdx] };
  }
  // Same topic, but wording/content changed → supersede the old one.
  if (bestScore >= 0.5) {
    const old = facts[bestIdx];
    const updated = {
      ...old,
      text,
      tags: [...new Set([...(old.tags || []), ...tags])],
      source,
      updatedAt: nowISO(),
      supersededText: old.text,
    };
    facts[bestIdx] = updated;
    writeAll(facts);
    return { status: 'updated', fact: updated };
  }
  // Genuinely new.
  const fact = {
    id: crypto.randomUUID(),
    text, tags, source,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  facts.push(fact);
  writeAll(facts);
  return { status: 'added', fact };
}

export function updateFact(id, { text, tags }) {
  const facts = readAll();
  const i = facts.findIndex((f) => f.id === id);
  if (i < 0) return { status: 'not_found' };
  if (text != null) facts[i].text = String(text).trim();
  if (tags != null) facts[i].tags = tags;
  facts[i].updatedAt = nowISO();
  writeAll(facts);
  return { status: 'updated', fact: facts[i] };
}

export function deleteFact(id) {
  const facts = readAll();
  const next = facts.filter((f) => f.id !== id);
  if (next.length === facts.length) return { status: 'not_found' };
  writeAll(next);
  return { status: 'deleted' };
}

export function searchFacts(query, { limit = 10, tag = null } = {}) {
  const terms = tokenize(query);
  const facts = readAll();
  const scored = [];
  for (const f of facts) {
    if (tag && !(f.tags || []).includes(tag)) continue;
    const ft = tokenize(f.text);
    let score = 0;
    for (const t of terms) if (ft.has(t)) score++;
    // light recency tiebreak
    const ts = Date.parse(f.updatedAt || f.createdAt || '') || 0;
    if (score > 0 || !terms.size) {
      scored.push({ score: score + (ts ? ts / 1e16 : 0), f });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.f);
}

export function listFacts({ limit = 50 } = {}) {
  const facts = readAll();
  return facts
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
    .slice(0, limit);
}

export function stats() {
  const facts = readAll();
  const tags = {};
  for (const f of facts) for (const t of (f.tags || [])) tags[t] = (tags[t] || 0) + 1;
  return { total: facts.length, tags };
}
