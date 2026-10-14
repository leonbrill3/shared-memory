// Distiller: raw captured conversation -> durable facts -> shared memory.
// Reads data/events.jsonl, extracts facts with Gemini (free tier), and writes
// them into the shared store via the live MCP endpoint (so Muse/ChatGPT see them).
// Resumable via data/distill-state.json. Usage:
//   node src/distill/distill.mjs [maxChunks]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const EVENTS = path.join(ROOT, 'data', 'events.jsonl');
const STATE = path.join(ROOT, 'data', 'distill-state.json');

// --- credentials ---
function readEnvKey(name) {
  if (process.env[name]) return process.env[name];
  const f = path.join(process.env.HOME, 'desgraciado', '.env');
  if (fs.existsSync(f)) {
    const m = fs.readFileSync(f, 'utf8').match(new RegExp(`^${name}=["']?([^"'\\n]+)`, 'm'));
    if (m) return m[1];
  }
  return null;
}
const GEMINI_KEY = readEnvKey('GEMINI_API_KEY');
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const MCP_URL = process.env.MCP_URL;
const MCP_TOKEN = process.env.MCP_TOKEN;
if (!GEMINI_KEY) { console.error('no GEMINI_API_KEY'); process.exit(1); }
if (!MCP_URL) { console.error('set MCP_URL (+ MCP_TOKEN) to the live endpoint'); process.exit(1); }

// --- never let a credential reach the shared store ---
const SECRET = /(bearer\s+[\w.\-]{10,}|rnd_[\w]{8,}|sk-[\w]{8,}|AIza[\w\-]{15,}|AQ\.[\w\-]{8,}|ghp_[\w]{8,}|-----BEGIN|password\s*[:=]|secret\s*[:=]|api[_-]?key\s*[:=]|[A-Za-z0-9_\-]{28,}\.[A-Za-z0-9_\-]{6,})/i;
const looksSecret = (s) => SECRET.test(s || '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEvents() {
  return fs.readFileSync(EVENTS, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function chunkFrom(events, start, maxChars = 4000) {
  const chunks = [];
  let cur = [], len = 0, session = null;
  for (let i = start; i < events.length; i++) {
    const e = events[i];
    const line = `${e.role}: ${(e.text || '').slice(0, 800)}`;
    if (cur.length && (len + line.length > maxChars || (session && e.session !== session))) {
      chunks.push({ endIndex: i - 1, text: cur.join('\n') });
      cur = []; len = 0;
    }
    cur.push(line); len += line.length; session = e.session;
  }
  if (cur.length) chunks.push({ endIndex: events.length - 1, text: cur.join('\n') });
  return chunks;
}

const PROMPT = (text) => `You extract durable long-term memory facts about a user named Leon from a conversation excerpt between Leon and an AI assistant.

Return STRICT JSON only: {"facts":[{"text":"...","tags":["..."]}]}

Rules:
- Only DURABLE, reusable facts: who Leon is, his preferences, his projects, people in his life, decisions, recurring constraints, important data.
- Each fact: ONE short standalone sentence, present tense, self-contained (use proper names, never "he/it/this/that").
- 1-3 lowercase tags per fact (e.g. "preference","project","device","family","tax","work").
- SKIP: small talk, one-off commands, debugging steps, anything about building this shared-memory system itself, and anything transient.
- NEVER include secrets: API keys, tokens, bearer tokens, passwords, connection strings. If a fact would contain one, omit that fact entirely.
- If nothing durable is present, return {"facts":[]}.

Conversation excerpt:
<<<
${text}
>>>`;

async function gemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } };
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const t = j.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  try { return JSON.parse(t); } catch { return { facts: [] }; }
}

async function main() {
  const maxChunks = Number(process.argv[2]) || Infinity;
  const events = loadEvents();
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { nextIndex: 0, facts: 0 };
  const chunks = chunkFrom(events, state.nextIndex);
  console.error(`distill: ${events.length} events, resuming at ${state.nextIndex}, ${chunks.length} chunks ahead`);

  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL),
    MCP_TOKEN ? { requestInit: { headers: { Authorization: `Bearer ${MCP_TOKEN}` } } } : undefined);
  const client = new Client({ name: 'distiller', version: '1.0.0' });
  await client.connect(transport);

  let processed = 0, added = 0, skipped = 0, consecErr = 0;
  for (const ch of chunks) {
    if (processed >= maxChunks) break;
    let out;
    try { out = await gemini(PROMPT(ch.text)); consecErr = 0; }
    catch (e) {
      console.error('  gemini error:', e.message.slice(0, 120));
      if (++consecErr >= 5) { console.error('aborting: 5 consecutive gemini errors'); break; }
      await sleep(8000); continue;
    }
    for (const f of (out.facts || [])) {
      if (!f?.text || looksSecret(f.text)) { skipped++; continue; }
      try {
        const r = await client.callTool({ name: 'memory_add', arguments: { text: f.text, tags: f.tags || [], source: 'distiller' } });
        const status = JSON.parse(r.content[0].text).status;
        if (status === 'added') { added++; console.error(`  + ${f.text.slice(0, 80)}`); }
      } catch (e) { console.error('  memory_add error:', e.message); }
    }
    processed++;
    state.nextIndex = ch.endIndex + 1; state.facts = (state.facts || 0) + added;
    fs.writeFileSync(STATE, JSON.stringify(state));
    await sleep(4200); // ~14/min, within Gemini free-tier RPM
  }
  await client.close();
  console.error(`\ndistill done: ${processed} chunks, ${added} new facts added, ${skipped} skipped (secret/empty). cursor at ${state.nextIndex}/${events.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
