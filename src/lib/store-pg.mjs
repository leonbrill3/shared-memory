// Postgres-backed facts store. Same interface as store-file.mjs, async.
// Lives in its own isolated table so it can safely share an existing database.
import crypto from 'node:crypto';
import pg from 'pg';

const TABLE = 'shared_memory_facts';
const conn = process.env.DATABASE_URL;
const pool = new pg.Pool({
  connectionString: conn,
  ssl: /\.render\.com/.test(conn || '') ? { rejectUnauthorized: false } : undefined,
  max: 4,
});

let ready;
async function init() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id uuid PRIMARY KEY,
        text text NOT NULL,
        tags text[] NOT NULL DEFAULT '{}',
        source text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        superseded_text text
      )`);
  }
  return ready;
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

export async function addFact({ text, tags = [], source = 'unknown' }) {
  await init();
  text = (text || '').trim();
  if (!text) throw new Error('text is required');
  const { rows } = await pool.query(`SELECT id, text, tags FROM ${TABLE}`);
  const incoming = tokenize(text);
  let best = null, bestScore = 0;
  for (const r of rows) {
    const s = jaccard(incoming, tokenize(r.text));
    if (s > bestScore) { bestScore = s; best = r; }
  }
  if (bestScore >= 0.9) {
    const { rows: [f] } = await pool.query(`SELECT * FROM ${TABLE} WHERE id=$1`, [best.id]);
    return { status: 'duplicate', fact: row2fact(f) };
  }
  if (bestScore >= 0.5) {
    const mergedTags = [...new Set([...(best.tags || []), ...tags])];
    const { rows: [f] } = await pool.query(
      `UPDATE ${TABLE} SET text=$2, tags=$3, source=$4, updated_at=now(), superseded_text=$5
       WHERE id=$1 RETURNING *`,
      [best.id, text, mergedTags, source, best.text]);
    return { status: 'updated', fact: row2fact(f) };
  }
  const id = crypto.randomUUID();
  const { rows: [f] } = await pool.query(
    `INSERT INTO ${TABLE} (id, text, tags, source) VALUES ($1,$2,$3,$4) RETURNING *`,
    [id, text, tags, source]);
  return { status: 'added', fact: row2fact(f) };
}

export async function updateFact(id, { text, tags }) {
  await init();
  const sets = [], vals = [id]; let i = 2;
  if (text != null) { sets.push(`text=$${i++}`); vals.push(String(text).trim()); }
  if (tags != null) { sets.push(`tags=$${i++}`); vals.push(tags); }
  if (!sets.length) return { status: 'no_change' };
  sets.push('updated_at=now()');
  const { rows } = await pool.query(`UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, vals);
  return rows.length ? { status: 'updated', fact: row2fact(rows[0]) } : { status: 'not_found' };
}

export async function deleteFact(id) {
  await init();
  const { rowCount } = await pool.query(`DELETE FROM ${TABLE} WHERE id=$1`, [id]);
  return { status: rowCount ? 'deleted' : 'not_found' };
}

export async function searchFacts(query, { limit = 10, tag = null } = {}) {
  await init();
  const terms = tokenize(query);
  const { rows } = await pool.query(
    tag ? `SELECT * FROM ${TABLE} WHERE $1 = ANY(tags)` : `SELECT * FROM ${TABLE}`,
    tag ? [tag] : []);
  const scored = [];
  for (const r of rows) {
    const ft = tokenize(r.text);
    let score = 0; for (const t of terms) if (ft.has(t)) score++;
    const ts = Date.parse(r.updated_at) || 0;
    if (score > 0 || !terms.size) scored.push({ score: score + (ts ? ts / 1e16 : 0), r });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => row2fact(s.r));
}

export async function listFacts({ limit = 50 } = {}) {
  await init();
  const { rows } = await pool.query(`SELECT * FROM ${TABLE} ORDER BY updated_at DESC LIMIT $1`, [limit]);
  return rows.map(row2fact);
}

export async function stats() {
  await init();
  const { rows } = await pool.query(`SELECT tags FROM ${TABLE}`);
  const tags = {};
  for (const r of rows) for (const t of (r.tags || [])) tags[t] = (tags[t] || 0) + 1;
  return { total: rows.length, tags };
}
