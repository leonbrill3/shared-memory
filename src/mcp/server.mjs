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
2. Whenever the user reveals a DURABLE fact about themselves, the people in their life, their projects, decisions, or preferences, call memory_add to save it so the other assistants know it too.
3. BEFORE alerting the user to anything (a deadline, an email, a task, a reminder), call list_open_items. If the matter is already open there, do not create a duplicate; if it has been resolved/dismissed, do NOT raise it again. When you surface something NEW that the user may need to act on, call log_event so it appears on their shared board.
4. When the user says they have handled or no longer care about something, call resolve_item so every assistant stops raising it.
5. NEVER save secrets, passwords, API keys, or tokens.
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
      type: z.string().optional().describe('e.g. "action","email","calendar","deadline","status".'),
      source: z.string().optional().describe('Which assistant/app (e.g. "muse","claude","chatgpt").'),
    },
  }, async ({ text, type, source }) => fmt(await (emit?.({ type: type || 'event', text, source: source || 'mcp', actor: source || 'mcp' }) ?? { ok: true })));

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

    if (url.startsWith('/api/events') && req.method === 'GET') {
      const uid = await getUserIdByToken(bearer(req) || qToken);
      if (!uid) return json(res, 401, { error: 'invalid token' });
      const open = /[?&]open=1/.test(url);
      let events = await listEvents(uid, { limit: 100, status: open ? 'open' : null });
      // The open board is actionable items only — never the resolution/activity
      // log entries (type 'resolved'/'learned'), which are feed signals, not tasks.
      if (open) events = events.filter((e) => e.type !== 'resolved' && e.type !== 'learned');
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
