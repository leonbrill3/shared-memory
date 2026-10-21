// Multi-tenant Postgres store. Each user has their own token and an isolated
// set of facts (scoped by user_id). Same fact interface as before, but every
// call is scoped to a userId. Also handles user creation + token resolution.
import crypto from 'node:crypto';
import pg from 'pg';
import * as match from './match.mjs';

const FACTS = 'shared_memory_facts';
const USERS = 'shared_memory_users';
const EVENTS_T = 'shared_memory_events';
const conn = process.env.DATABASE_URL;
const pool = new pg.Pool({
  connectionString: conn,
  ssl: /\.render\.com/.test(conn || '') ? { rejectUnauthorized: false } : undefined,
  max: 4,
});

let ready;
async function init() {
  if (ready) return ready;
  ready = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${USERS} (
        id uuid PRIMARY KEY,
        token text UNIQUE NOT NULL,
        label text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${FACTS} (
        id uuid PRIMARY KEY,
        text text NOT NULL,
        tags text[] NOT NULL DEFAULT '{}',
        source text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        superseded_text text
      )`);
    // migrate: add user_id if missing
    await pool.query(`ALTER TABLE ${FACTS} ADD COLUMN IF NOT EXISTS user_id uuid`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${FACTS}_user ON ${FACTS}(user_id)`);
    // live activity stream (the "heartbeat" — time-stamped events as they happen)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${EVENTS_T} (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        ts timestamptz NOT NULL DEFAULT now(),
        type text,
        text text NOT NULL,
        source text,
        actor text,
        meta jsonb
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${EVENTS_T}_user_ts ON ${EVENTS_T}(user_id, ts DESC)`);
    // self-migrate the original single-tenant data to a Leon user keyed by MEMORY_TOKEN
    const legacy = process.env.MEMORY_TOKEN;
    if (legacy) {
      let { rows } = await pool.query(`SELECT id FROM ${USERS} WHERE token=$1`, [legacy]);
      let leonId = rows[0]?.id;
      if (!leonId) {
        leonId = crypto.randomUUID();
        await pool.query(`INSERT INTO ${USERS}(id, token, label) VALUES ($1,$2,$3)`, [leonId, legacy, 'Leon (owner)']);
      }
      await pool.query(`UPDATE ${FACTS} SET user_id=$1 WHERE user_id IS NULL`, [leonId]);
    }
  })();
  return ready;
}

// --- users ---
export async function getUserIdByToken(token) {
  await init();
  if (!token) return null;
  const { rows } = await pool.query(`SELECT id FROM ${USERS} WHERE token=$1`, [token]);
  return rows[0]?.id || null;
}

export async function createUser(label) {
  await init();
  const id = crypto.randomUUID();
  const token = 'sm_' + crypto.randomBytes(24).toString('base64url');
  await pool.query(`INSERT INTO ${USERS}(id, token, label) VALUES ($1,$2,$3)`, [id, token, label || null]);
  return { id, token };
}

const row2fact = (r) => ({
  id: r.id, text: r.text, tags: r.tags || [], source: r.source,
  createdAt: r.created_at, updatedAt: r.updated_at,
  ...(r.superseded_text ? { supersededText: r.superseded_text } : {}),
});

function tokenize(s) { return new Set((((s || '').toLowerCase().match(/[a-z0-9]+/g)) || [])); }
function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0; for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
const normTag = (t) => String(t).toLowerCase().trim().replace(/\s+/g, '-');

export async function addFact(userId, { text, tags = [], source = 'unknown' }) {
  await init();
  text = (text || '').trim();
  if (!text) throw new Error('text is required');
  tags = [...new Set((tags || []).map(normTag))];
  const { rows } = await pool.query(`SELECT id, text, tags FROM ${FACTS} WHERE user_id=$1`, [userId]);
  const incoming = tokenize(text);
  let best = null, bestScore = 0;
  for (const r of rows) {
    const s = jaccard(incoming, tokenize(r.text));
    if (s > bestScore) { bestScore = s; best = r; }
  }
  if (bestScore >= 0.82) {
    const { rows: [f] } = await pool.query(`SELECT * FROM ${FACTS} WHERE id=$1`, [best.id]);
    return { status: 'duplicate', fact: row2fact(f) };
  }
  if (bestScore >= 0.45) {
    const mergedTags = [...new Set([...(best.tags || []), ...tags])];
    const { rows: [f] } = await pool.query(
      `UPDATE ${FACTS} SET text=$2, tags=$3, source=$4, updated_at=now(), superseded_text=$5 WHERE id=$1 RETURNING *`,
      [best.id, text, mergedTags, source, best.text]);
    return { status: 'updated', fact: row2fact(f) };
  }
  const id = crypto.randomUUID();
  const { rows: [f] } = await pool.query(
    `INSERT INTO ${FACTS} (id, user_id, text, tags, source) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, userId, text, tags, source]);
  return { status: 'added', fact: row2fact(f) };
}

export async function updateFact(userId, id, { text, tags }) {
  await init();
  const sets = [], vals = [id, userId]; let i = 3;
  if (text != null) { sets.push(`text=$${i++}`); vals.push(String(text).trim()); }
  if (tags != null) { sets.push(`tags=$${i++}`); vals.push([...new Set(tags.map(normTag))]); }
  if (!sets.length) return { status: 'no_change' };
  sets.push('updated_at=now()');
  const { rows } = await pool.query(`UPDATE ${FACTS} SET ${sets.join(', ')} WHERE id=$1 AND user_id=$2 RETURNING *`, vals);
  return rows.length ? { status: 'updated', fact: row2fact(rows[0]) } : { status: 'not_found' };
}

export async function deleteFact(userId, id) {
  await init();
  const { rowCount } = await pool.query(`DELETE FROM ${FACTS} WHERE id=$1 AND user_id=$2`, [id, userId]);
  return { status: rowCount ? 'deleted' : 'not_found' };
}

export async function searchFacts(userId, query, { limit = 10, tag = null } = {}) {
  await init();
  const q = match.terms(query);
  const { rows } = await pool.query(
    tag ? `SELECT * FROM ${FACTS} WHERE user_id=$1 AND $2 = ANY(tags)` : `SELECT * FROM ${FACTS} WHERE user_id=$1`,
    tag ? [userId, normTag(tag)] : [userId]);
  const scored = [];
  for (const r of rows) {
    const base = match.scoreText(q, r.text);
    if (base <= 0 && q.length) continue;
    const ts = Date.parse(r.updated_at) || 0;
    scored.push({ score: base + (ts ? ts / 1e16 : 0), r });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => row2fact(s.r));
}

export async function listFacts(userId, { limit = 50 } = {}) {
  await init();
  const { rows } = await pool.query(`SELECT * FROM ${FACTS} WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2`, [userId, limit]);
  return rows.map(row2fact);
}

export async function stats(userId) {
  await init();
  const { rows } = await pool.query(`SELECT tags FROM ${FACTS} WHERE user_id=$1`, [userId]);
  const tags = {};
  for (const r of rows) for (const t of (r.tags || [])) tags[t] = (tags[t] || 0) + 1;
  return { total: rows.length, tags };
}

// --- live activity events ---
const row2event = (r) => ({ id: r.id, ts: r.ts, type: r.type, text: r.text, source: r.source, actor: r.actor, meta: r.meta || null });

export async function logEvent(userId, { type = 'event', text, source = null, actor = null, meta = null }) {
  await init();
  const id = crypto.randomUUID();
  const { rows: [r] } = await pool.query(
    `INSERT INTO ${EVENTS_T}(id, user_id, type, text, source, actor, meta) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, userId, type, text, source, actor, meta ? JSON.stringify(meta) : null]);
  return row2event(r);
}

export async function listEvents(userId, { limit = 50 } = {}) {
  await init();
  const { rows } = await pool.query(`SELECT * FROM ${EVENTS_T} WHERE user_id=$1 ORDER BY ts DESC LIMIT $2`, [userId, limit]);
  return rows.map(row2event);
}
