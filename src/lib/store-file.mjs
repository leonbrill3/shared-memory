// Local-dev file store (single user). Mirrors store-pg's interface, but userId
// is accepted and ignored (there is only one local user). Used when no
// DATABASE_URL is configured.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import * as match from './match.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const MEM = path.join(DATA_DIR, 'memory.jsonl');
const ACT = path.join(DATA_DIR, 'activity.jsonl');
fs.mkdirSync(DATA_DIR, { recursive: true });

export async function getUserIdByToken() { return 'local'; }
export async function createUser() { return { id: 'local', token: 'local' }; }

const nowISO = () => new Date().toISOString();
const normTag = (t) => String(t).toLowerCase().trim().replace(/\s+/g, '-');
function readAll() {
  if (!fs.existsSync(MEM)) return [];
  return fs.readFileSync(MEM, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function writeAll(f) { fs.writeFileSync(MEM, f.map((x) => JSON.stringify(x)).join('\n') + (f.length ? '\n' : '')); }
function tokenize(s) { return new Set((((s || '').toLowerCase().match(/[a-z0-9]+/g)) || [])); }
function jaccard(a, b) { if (!a.size && !b.size) return 1; let i = 0; for (const t of a) if (b.has(t)) i++; return i / (a.size + b.size - i); }

export async function addFact(_userId, { text, tags = [], source = 'unknown' }) {
  text = (text || '').trim(); if (!text) throw new Error('text is required');
  tags = [...new Set((tags || []).map(normTag))];
  const facts = readAll(); const inc = tokenize(text);
  let bi = -1, bs = 0;
  for (let i = 0; i < facts.length; i++) { const s = jaccard(inc, tokenize(facts[i].text)); if (s > bs) { bs = s; bi = i; } }
  if (bs >= 0.82) return { status: 'duplicate', fact: facts[bi] };
  if (bs >= 0.45) {
    const old = facts[bi];
    facts[bi] = { ...old, text, tags: [...new Set([...(old.tags || []), ...tags])], source, updatedAt: nowISO(), supersededText: old.text };
    writeAll(facts); return { status: 'updated', fact: facts[bi] };
  }
  const fact = { id: crypto.randomUUID(), text, tags, source, createdAt: nowISO(), updatedAt: nowISO() };
  facts.push(fact); writeAll(facts); return { status: 'added', fact };
}
export async function updateFact(_userId, id, { text, tags }) {
  const f = readAll(); const i = f.findIndex((x) => x.id === id); if (i < 0) return { status: 'not_found' };
  if (text != null) f[i].text = String(text).trim();
  if (tags != null) f[i].tags = [...new Set(tags.map(normTag))];
  f[i].updatedAt = nowISO(); writeAll(f); return { status: 'updated', fact: f[i] };
}
export async function deleteFact(_userId, id) {
  const f = readAll(); const n = f.filter((x) => x.id !== id);
  if (n.length === f.length) return { status: 'not_found' }; writeAll(n); return { status: 'deleted' };
}
export async function searchFacts(_userId, query, { limit = 10, tag = null } = {}) {
  const q = match.terms(query); const facts = readAll(); const sc = [];
  for (const f of facts) {
    if (tag && !(f.tags || []).includes(normTag(tag))) continue;
    const base = match.scoreText(q, f.text); if (base <= 0 && q.length) continue;
    const ts = Date.parse(f.updatedAt || f.createdAt || '') || 0;
    sc.push({ score: base + (ts ? ts / 1e16 : 0), f });
  }
  sc.sort((a, b) => b.score - a.score); return sc.slice(0, limit).map((s) => s.f);
}
export async function listFacts(_userId, { limit = 50 } = {}) {
  return readAll().sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt)).slice(0, limit);
}
export async function stats(_userId) {
  const facts = readAll(); const tags = {};
  for (const f of facts) for (const t of (f.tags || [])) tags[t] = (tags[t] || 0) + 1;
  return { total: facts.length, tags };
}

function readActs() {
  if (!fs.existsSync(ACT)) return [];
  return fs.readFileSync(ACT, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
export async function logEvent(_userId, { type = 'event', text, source = null, actor = null, meta = null }) {
  const e = { id: crypto.randomUUID(), ts: nowISO(), type, text, source, actor, status: 'open', resolvedAt: null, resolvedBy: null, meta };
  fs.appendFileSync(ACT, JSON.stringify(e) + '\n');
  return e;
}
export async function listEvents(_userId, { limit = 50, status = null } = {}) {
  let all = readActs().reverse();
  if (status) all = all.filter((e) => (e.status || 'open') === status);
  return all.slice(0, limit);
}
export async function resolveEvent(_userId, id, { status = 'done', by = null } = {}) {
  const all = readActs(); const i = all.findIndex((e) => e.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], status, resolvedAt: nowISO(), resolvedBy: by };
  fs.writeFileSync(ACT, all.map((x) => JSON.stringify(x)).join('\n') + (all.length ? '\n' : ''));
  return all[i];
}
