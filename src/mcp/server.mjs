#!/usr/bin/env node
// Multi-tenant shared-memory MCP server + website.
//   GET  /            -> landing + dashboard (signup, connect steps, live facts)
//   POST /api/signup  -> create a user, return their token + MCP url
//   GET  /api/me      -> that user's facts + stats (bearer token)
//   */mcp             -> the MCP endpoint, scoped to the token's user
// Run modes:
//   node src/mcp/server.mjs            # stdio (local dev, single 'local' user)
//   node src/mcp/server.mjs --http     # streamable HTTP (the deployed service)
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { addFact, searchFacts, updateFact, deleteFact, listFacts, stats, getUserIdByToken, createUser, logEvent, listEvents, resolveEvent } from '../lib/store.mjs';
import { renderPage } from '../web/page.mjs';

const fmt = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

const SERVER_INSTRUCTIONS = `This is the user's SHARED MEMORY — one memory used in common by ALL of the user's AI assistants (Muse, Claude, ChatGPT). Keeping it current is how those assistants stay on the same page.

Behave this way automatically, without being asked:
1. At the START of a conversation or whenever the user asks you to do something, call memory_search with their request to load what is already known about them, their family, their projects, and their preferences — then use it in your answer.
2. Whenever the user reveals a DURABLE fact about themselves, the people in their life, their projects, decisions, or preferences, call memory_add to save it so the other assistants know it too. When the fact comes out of a specific conversation or document, INCLUDE A LINK TO THAT SOURCE in the fact (e.g. the chat/thread URL, the Google Doc URL) — so another assistant can hand the user back to exactly where the work happened.
3. BEFORE alerting the user to anything (a deadline, an email, a task, a reminder), call list_open_items. If the matter is already open there, do not create a duplicate; if it has been resolved/dismissed, do NOT raise it again. When you surface something NEW that the user may need to act on, call log_event so it appears on their shared board. REMINDERS: when the user asks you to remind them of something, to remember to do something, or names a future to-do with a time, you MUST call the dedicated `set_reminder` tool (text + whenISO). Do NOT merely promise to remind them yourself — a promise in this chat never reaches their dashboard; only set_reminder does. Always call it for any reminder request.
4. When the user says they have handled or no longer care about something, call resolve_item so every assistant stops raising it.
5. CRITICAL — when YOU take a real action on the user's behalf or complete a task for them (file a form or request, send a message or reply, make a booking, pay a bill, submit an application, schedule something, resolve an issue), you MUST immediately: (a) call log_event with a clear past-tense description of exactly what you did (e.g. "Filed the Aqualectra reimbursement request for Karen Cheis"), and (b) call list_open_items and resolve_item for any open item this action handles — so the other assistants (including the user's dashboard) know it is DONE and stop raising it. Recording what you did is as important as doing it; an action the others can't see leaves them nagging the user about something already finished.
6. DELEGATED TASKS — when you call list_open_items, watch for any item ADDRESSED TO YOU: its text begins with "→ For <you>" (e.g. "→ For Muse: …") or its details name you as the assignee. Another assistant has handed you that task because you're the one who can do it. Carry it out when you're able (it will include the full context you need), then call resolve_item and log_event describing what you did. If you genuinely cannot do it, call log_event explaining why so it can be re-routed — do not silently ignore it.
7. WHILE WORKING A DELEGATED TASK, keep the user's dashboard in the loop with log_event calls carrying meta.forTask = the delegated item's id:
   - progress: type 'status', e.g. "Opened the Google Cloud Console, navigating to OAuth consent screen".
   - BLOCKED/NEEDS INPUT: type 'needs' with meta.need describing what you need (e.g. meta.need = 'login' or 'decision'), e.g. "Need Leon's Google Cloud login to continue". The user will respond (securely, on their side) and you continue.
   - done: resolve_item (rule 5) plus a final 'status' saying it's finished.
   This lets the user SEE what you're doing and what you need, live. Never ask for or store a password in memory — only state THAT you need the login; the user provides it to you directly in your own session, never in this shared memory.
8. NEVER save secrets, passwords, API keys, or tokens.
Treat this shared memory as the single source of truth across all of the user's assistants.`;

// A server instance is bound to one userId; its tools operate only on that user's memory.
// `emit(evt)` records a live activity event (persisted + streamed to the board).
function createServer(userId, emit) {
  const server = new McpServer({ name: 'shared-memory', version: '0.3.0' }, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool('memory_add', {
    title: 'Add to shared memory',
    description: 'Save a durable fact to the shared memory that all of the user\'s assistants read. For lasting info about the user, their people, projects, preferences, and decisions — not transient chatter or secrets. Near-identical facts are deduped; changed facts supersede the old version.',
    inputSchema: {
      text: z.string().describe('The fact, as a short standalone statement.'),
      tags: z.array(z.string()).optional().describe('Optional topic tags, e.g. ["home","preference"].'),
      source: z.string().optional().describe('Which assistant is saving this (e.g. "muse","claude","chatgpt").'),
    },
  }, async ({ text, tags, source }) => {
    const r = await addFact(userId, { text, tags, source: source || 'mcp' });
    if (r.status !== 'duplicate') emit?.({ type: 'learned', text: r.fact.text, source: source || 'mcp', actor: source || 'mcp' });
    return fmt(r);
  });

  server.registerTool('log_event', {
    title: 'Log a live activity event',
    description: 'Record something that just HAPPENED (an action taken, a message, a booking, a deadline, a status change) so it appears on the user\'s live activity board. Use for transient happenings; use memory_add for durable facts.',
    inputSchema: {
      text: z.string().describe('What happened, as a short line.'),
      type: z.string().optional().describe('e.g. "action","email","calendar","deadline","status","reminder".'),
      source: z.string().optional().describe('Which assistant/app (e.g. "muse","claude","chatgpt").'),
      meta: z.record(z.any()).optional().describe('Optional structured details, e.g. {startTs:"<ISO due time>"} for a reminder, or {forTask,need} while working a delegated task.'),
    },
  }, async ({ text, type, source, meta }) => fmt(await (emit?.({ type: type || 'event', text, source: source || 'mcp', actor: source || 'mcp', meta: meta || null }) ?? { ok: true })));

  server.registerTool('set_reminder', {
    title: 'Set a reminder for the user',
    description: 'Call this WHENEVER the user asks to be reminded of something, to remember to do something, or mentions a future to-do with a time ("remind me to…", "don\'t let me forget…", "tomorrow I need to…"). This puts the reminder on the user\'s Sprock dashboard so it shows up across all their assistants and devices. Always call it for reminder requests — do NOT just promise to remind them yourself, as that stays trapped in this chat. This is the ONLY way a reminder reaches their dashboard.',
    inputSchema: {
      text: z.string().describe('What to remind them about, as a short actionable line (e.g. "Laundry and car wash", "Call Cenk — birthday").'),
      whenISO: z.string().optional().describe('The due date+time in ISO 8601 (e.g. "2026-10-25T09:15:00"). Resolve relative times like "tomorrow 9am" against the current date before calling.'),
      whenText: z.string().optional().describe('A human-friendly when, e.g. "tomorrow 9:15 AM" — used if whenISO is omitted.'),
      source: z.string().optional().describe('Which assistant set it (e.g. "muse").'),
    },
  }, async ({ text, whenISO, whenText, source }) => {
    const meta = { kind: 'reminder' };
    if (whenISO) meta.startTs = whenISO;
    if (whenText) meta.when = whenText;
    else if (whenISO) { try { meta.when = new Date(whenISO).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch {} }
    const line = meta.when ? `${text} — ${meta.when}` : text;
    return fmt(await (emit?.({ type: 'reminder', text: line, source: source || 'mcp', actor: source || 'mcp', meta }) ?? { ok: true }));
  });

  server.registerTool('list_open_items', {
    title: 'List open board items',
    description: 'List the items currently OPEN on the user\'s shared board (things not yet handled/dismissed). Call this before alerting the user to anything, so you don\'t raise something already on the board or already resolved.',
    inputSchema: { limit: z.number().int().positive().max(100).optional() },
  }, async ({ limit }) => {
    const items = (await listEvents(userId, { limit: (limit || 50) * 3, status: 'open' }))
      .filter((e) => e.type !== 'learned' && e.type !== 'resolved');
    return fmt(items.slice(0, limit || 50));
  });

  server.registerTool('resolve_item', {
    title: 'Resolve a board item',
    description: 'Mark a board item handled so EVERY assistant stops raising it. Use when the user indicates they did it or no longer care. status: "done" (handled) or "dismissed" (ignore).',
    inputSchema: {
      id: z.string().describe('The item id.'),
      status: z.enum(['done', 'dismissed', 'snoozed']).optional(),
      source: z.string().optional(),
    },
  }, async ({ id, status, source }) => {
    const r = await resolveEvent(userId, id, { status: status || 'done', by: source || 'mcp' });
    if (r) emit?.({ type: 'resolved', text: `${status === 'dismissed' ? 'Dismissed' : 'Done'}: ${r.text}`, source: source || 'mcp', actor: source || 'mcp' });
    return fmt(r || { status: 'not_found' });
  });

  server.registerTool('memory_search', {
    title: 'Search shared memory',
    description: 'Find relevant facts from the shared memory. Call this at the start of a task to stay on the same page as the user\'s other assistants.',
    inputSchema: {
      query: z.string().describe('What to look for.'),
      limit: z.number().int().positive().max(50).optional(),
      tag: z.string().optional(),
    },
  }, async ({ query, limit, tag }) => fmt(await searchFacts(userId, query, { limit: limit || 10, tag: tag || null })));

  server.registerTool('memory_list', {
    title: 'List recent memory',
    description: 'List the most recently updated facts in the shared memory.',
    inputSchema: { limit: z.number().int().positive().max(200).optional() },
  }, async ({ limit }) => fmt(await listFacts(userId, { limit: limit || 50 })));

  server.registerTool('memory_update', {
    title: 'Update a fact',
    description: 'Update an existing fact by id.',
    inputSchema: { id: z.string(), text: z.string().optional(), tags: z.array(z.string()).optional() },
  }, async ({ id, text, tags }) => fmt(await updateFact(userId, id, { text, tags })));

  server.registerTool('memory_delete', {
    title: 'Delete a fact',
    description: 'Remove a fact from shared memory by id.',
    inputSchema: { id: z.string() },
  }, async ({ id }) => fmt(await deleteFact(userId, id)));

  server.registerTool('memory_stats', {
    title: 'Memory stats',
    description: 'How many facts are stored and the tag breakdown.',
    inputSchema: {},
  }, async () => fmt(await stats(userId)));

  return server;
}

const readBody = (req) => new Promise((resolve) => {
  let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
});
const bearer = (req) => (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') || null;
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

async function main() {
  if (!process.argv.includes('--http')) {
    const server = createServer('local', (evt) => logEvent('local', evt));
    await server.connect(new StdioServerTransport());
    console.error('[shared-memory] MCP (stdio) ready');
    return;
  }

  const PORT = Number(process.env.PORT) || 8787;
  const sessions = {}; // sessionId -> { transport, userId }
  const sseSubs = new Map(); // userId -> Set<res>, live board subscribers

  // Persist an event and push it to any live board watching this user.
  async function emitEvent(userId, evt) {
    const stored = await logEvent(userId, evt);
    const subs = sseSubs.get(userId);
    if (subs) for (const r of subs) { try { r.write(`data: ${JSON.stringify(stored)}\n\n`); } catch {} }
    return stored;
  }

  const httpServer = http.createServer(async (req, res) => {
    const url = req.url || '/';

    if (url === '/' || url.startsWith('/?')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(renderPage()); }
    if (url.startsWith('/health')) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }

    if (url.startsWith('/api/signup') && req.method === 'POST') {
      const body = await readBody(req);
      const user = await createUser(body.label);
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const mcpUrl = `${proto}://${req.headers.host}/mcp`;
      return json(res, 200, { userId: user.id, token: user.token, mcpUrl });
    }

    if (url.startsWith('/api/me') && req.method === 'GET') {
      const uid = await getUserIdByToken(bearer(req));
      if (!uid) return json(res, 401, { error: 'invalid token' });
      const [st, facts] = [await stats(uid), await listFacts(uid, { limit: 200 })];
      return json(res, 200, { stats: st, facts });
    }

    // token can come from header or ?token= (EventSource can't set headers)
    const qToken = (() => { try { return new URL(url, 'http://x').searchParams.get('token'); } catch { return null; } })();

    if (url.startsWith('/api/events/stream')) {
      const uid = await getUserIdByToken(bearer(req) || qToken);
      if (!uid) return json(res, 401, { error: 'invalid token' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      if (!sseSubs.has(uid)) sseSubs.set(uid, new Set());
      sseSubs.get(uid).add(res);
      const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch {} }, 25000);
      req.on('close', () => { clearInterval(ka); sseSubs.get(uid)?.delete(res); });
      return;
    }

    const resolveMatch = url.match(/^\/api\/events\/([^/?]+)\/resolve/);
    if (resolveMatch && req.method === 'POST') {
      const uid = await getUserIdByToken(bearer(req) || qToken);
      if (!uid) return json(res, 401, { error: 'invalid token' });
      const body = await readBody(req);
      const st = body.status || 'done';
      const r = await resolveEvent(uid, resolveMatch[1], { status: st, by: 'you' });
      if (r) await emitEvent(uid, { type: 'resolved', text: `${st === 'dismissed' ? 'Dismissed' : 'Done'}: ${r.text}`, source: 'you', actor: 'you' });
      return json(res, r ? 200 : 404, r || { error: 'not found' });
    }

    // Create a board item (used by connector syncs, e.g. Sprock's Gmail/Calendar sync).
    // Dedups against currently-open items so repeated syncs don't pile up.
    if (url.startsWith('/api/events') && !url.includes('/stream') && req.method === 'POST') {
      const uid = await getUserIdByToken(bearer(req) || qToken);
      if (!uid) return json(res, 401, { error: 'invalid token' });
      const body = await readBody(req);
      if (!body.text) return json(res, 400, { error: 'text required' });
      const open = await listEvents(uid, { limit: 200, status: 'open' });
      if (open.some((e) => (e.text || '').trim() === String(body.text).trim())) {
        return json(res, 200, { status: 'duplicate' });
      }
      const ev = await emitEvent(uid, { type: body.type || 'event', text: String(body.text), source: body.source || 'sync', meta: body.meta || null });
      return json(res, 200, { status: 'created', event: ev });
    }

    // Create a durable fact (so Sprock/assistants can record what they learn).
    if ((url === '/api/facts' || url.startsWith('/api/facts?')) && req.method === 'POST') {
      const uid = await getUserIdByToken(bearer(req) || qToken);
      if (!uid) return json(res, 401, { error: 'invalid token' });
      const body = await readBody(req);
      if (!body.text) return json(res, 400, { error: 'text required' });
      const r = await addFact(uid, { text: String(body.text), tags: body.tags || [], source: body.source || 'sync' });
      return json(res, 200, { status: r.status || 'created', fact: r.fact || r });
    }

    // Correct or remove a wrong fact (so bad memory can be fixed, not just added).
    if (url.startsWith('/api/facts/') && (req.method === 'DELETE' || req.method === 'POST')) {
      const uid = await getUserIdByToken(bearer(req) || qToken);
      if (!uid) return json(res, 401, { error: 'invalid token' });
      const id = url.split('/api/facts/')[1].split('?')[0];
      if (req.method === 'DELETE') {
        return json(res, 200, { deleted: await deleteFact(uid, id) });
      }
      const body = await readBody(req);
      return json(res, 200, { updated: await updateFact(uid, id, { text: body.text, tags: body.tags }) });
    }

    if (url.startsWith('/api/events') && req.method === 'GET') {
      const uid = await getUserIdByToken(bearer(req) || qToken);
      if (!uid) return json(res, 401, { error: 'invalid token' });
      const open = /[?&]open=1/.test(url);
      let events = await listEvents(uid, { limit: 100, status: open ? 'open' : null });
      // The open board is actionable items only — never log/record entries:
      // 'resolved'/'learned' (feed signals) or 'done' (completion records that an
      // assistant logs so reconciliation can see them, not tasks for the user).
      if (open) events = events.filter((e) => !['resolved', 'learned', 'done', 'status', 'needs'].includes(e.type));
      return json(res, 200, { events });
    }

    if (url.startsWith('/mcp')) {
      const uid = await getUserIdByToken(bearer(req));
      if (!uid) return json(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized: missing or unknown token.' } });
      const sid = req.headers['mcp-session-id'];

      if (req.method === 'POST') {
        const body = await readBody(req);
        let entry = sid ? sessions[sid] : undefined;
        if (entry && entry.userId !== uid) return json(res, 403, { error: 'session/token mismatch' });
        if (!entry && !sid && body && body.method === 'initialize') {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => { sessions[id] = { transport, userId: uid }; },
          });
          transport.onclose = () => { if (transport.sessionId) delete sessions[transport.sessionId]; };
          await createServer(uid, (evt) => emitEvent(uid, evt)).connect(transport);
          entry = { transport, userId: uid };
        }
        if (!entry) return json(res, 400, { jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32000, message: 'No valid session; send initialize first.' } });
        return entry.transport.handleRequest(req, res, body);
      }
      if (req.method === 'GET' || req.method === 'DELETE') {
        const entry = sid && sessions[sid];
        if (!entry || entry.userId !== uid) { res.writeHead(400); return res.end('invalid session'); }
        return entry.transport.handleRequest(req, res);
      }
    }

    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
  });
  httpServer.listen(PORT, () => console.error(`[shared-memory] http + MCP on :${PORT}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
