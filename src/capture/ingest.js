#!/usr/bin/env node
// Local capture hub — the "can never break" core. Pure Node, zero deps.
// Watches local sources each app writes on THIS Mac and normalizes every
// turn into one append-only event log: data/events.jsonl
//
// Sources:
//   claude-code : ~/.claude/projects/**/*.jsonl   (full transcripts, live)
//   muse        : ~/Library/Caches/com.meta.endo/DebugLogs/  (after debug on)
//
// Usage:
//   node src/capture/ingest.js backfill   # one-time import of existing history
//   node src/capture/ingest.js watch      # real-time tail of all sources

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const EVENTS = path.join(DATA_DIR, 'events.jsonl');

const CLAUDE_CODE_DIR = path.join(HOME, '.claude', 'projects');
const MUSE_LOG_DIR = path.join(HOME, 'Library', 'Caches', 'com.meta.endo', 'DebugLogs');

fs.mkdirSync(DATA_DIR, { recursive: true });

// --- normalized event: {id, ts, source, session, role, text} ---
const seen = new Set();
function loadSeen() {
  if (!fs.existsSync(EVENTS)) return;
  for (const line of fs.readFileSync(EVENTS, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { seen.add(JSON.parse(line).id); } catch {}
  }
}
function emit(ev) {
  if (!ev.text || !ev.text.trim()) return;
  if (seen.has(ev.id)) return;
  seen.add(ev.id);
  fs.appendFileSync(EVENTS, JSON.stringify(ev) + '\n');
  return true;
}

// --- Claude Code JSONL parser ---
function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b;
        if (b && b.type === 'text') return b.text;
        if (b && b.type === 'tool_use') return `[tool:${b.name}] ${JSON.stringify(b.input)}`;
        if (b && b.type === 'tool_result')
          return `[tool_result] ${typeof b.content === 'string' ? b.content : JSON.stringify(b.content)}`;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function ingestClaudeCodeFile(file) {
  let n = 0;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const session = path.basename(file, '.jsonl');
  for (const line of lines) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    const msg = o.message || {};
    const text = textFromContent(msg.content);
    const ev = {
      id: `cc:${o.uuid || o.promptId || session + ':' + n}`,
      ts: o.timestamp || null,
      source: 'claude-code',
      session,
      role: msg.role || o.type,
      text,
    };
    if (emit(ev)) n++;
  }
  return n;
}

function walkJsonl(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsonl(p));
    else if (entry.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

// --- Muse DebugLogs parser (tolerant: format locks in once logs exist) ---
function ingestMuseFile(file) {
  let n = 0;
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  let i = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    // DebugLogs may be JSON-per-line or text. Handle both; keep Tool/Stream/transcript.
    let category = '', text = '', ts = null, role = 'assistant';
    try {
      const o = JSON.parse(line);
      category = o.category || o.source || '';
      ts = o.timestamp || o.ts || null;
      text = o.message || o.text || o.body || JSON.stringify(o);
      if (/user/i.test(o.direction || o.role || '')) role = 'user';
    } catch {
      text = line;
    }
    // Only keep conversational categories once we know them; for now keep all.
    const ev = {
      id: `muse:${path.basename(file)}:${i++}`,
      ts,
      source: 'muse',
      session: path.basename(file),
      role,
      text: category ? `[${category}] ${text}` : text,
    };
    if (emit(ev)) n++;
  }
  return n;
}

function backfill() {
  loadSeen();
  let cc = 0, ms = 0;
  const files = walkJsonl(CLAUDE_CODE_DIR);
  for (const f of files) cc += ingestClaudeCodeFile(f);
  if (fs.existsSync(MUSE_LOG_DIR)) {
    for (const f of fs.readdirSync(MUSE_LOG_DIR)) {
      const p = path.join(MUSE_LOG_DIR, f);
      if (fs.statSync(p).isFile()) ms += ingestMuseFile(p);
    }
  }
  const total = fs.existsSync(EVENTS)
    ? fs.readFileSync(EVENTS, 'utf8').split('\n').filter(Boolean).length
    : 0;
  console.log(`backfill complete`);
  console.log(`  claude-code: +${cc} events from ${files.length} transcripts`);
  console.log(`  muse:        +${ms} events${fs.existsSync(MUSE_LOG_DIR) && fs.readdirSync(MUSE_LOG_DIR).length ? '' : '  (DebugLogs empty — enable debug logging in Muse)'}`);
  console.log(`  total events in hub: ${total}`);
}

function watch() {
  loadSeen();
  console.log('watching live:');
  console.log('  claude-code ->', CLAUDE_CODE_DIR);
  console.log('  muse        ->', MUSE_LOG_DIR, fs.existsSync(MUSE_LOG_DIR) ? '' : '(dir missing until Muse runs w/ debug)');
  backfill();
  const rescan = () => backfill();
  fs.watch(CLAUDE_CODE_DIR, { recursive: true }, rescan);
  if (fs.existsSync(MUSE_LOG_DIR)) fs.watch(MUSE_LOG_DIR, { recursive: true }, rescan);
  setInterval(rescan, 5000); // safety poll
}

const cmd = process.argv[2] || 'backfill';
if (cmd === 'watch') watch();
else backfill();
