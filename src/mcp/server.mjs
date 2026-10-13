#!/usr/bin/env node
// The shared-memory MCP server. ONE server, three clients:
//   - Claude      : add via stdio (claude mcp add) or remote URL
//   - ChatGPT     : add the remote URL as a connector
//   - Muse        : "build a custom connector" pointed at the remote URL
// Run modes:
//   node src/mcp/server.mjs            # stdio  (local, for Claude Code)
//   node src/mcp/server.mjs --http     # streamable HTTP (remote, for Muse/ChatGPT)
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { addFact, searchFacts, updateFact, deleteFact, listFacts, stats } from '../lib/store.mjs';

const fmt = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

// Public deploys MUST set MEMORY_TOKEN. When set, every /mcp request needs
// `Authorization: Bearer <token>`. When unset (local dev), access is open.
const TOKEN = process.env.MEMORY_TOKEN;
function authorized(req) {
  if (!TOKEN) return true;
  return (req.headers['authorization'] || '') === `Bearer ${TOKEN}`;
}

function createServer() {
  const server = new McpServer({ name: 'shared-memory', version: '0.1.0' });

  server.registerTool('memory_add', {
    title: 'Add to shared memory',
    description:
      'Save a durable fact to the shared memory that Muse, Claude, and ChatGPT all share. ' +
      'Use for lasting info about the user, their projects, preferences, people, and decisions — not transient chatter. ' +
      'Near-identical facts are deduped; changed facts supersede the old version automatically.',
    inputSchema: {
      text: z.string().describe('The fact, as a short standalone statement.'),
      tags: z.array(z.string()).optional().describe('Optional topic tags, e.g. ["home","preference"].'),
      source: z.string().optional().describe('Which assistant/app is saving this (e.g. "muse","claude","chatgpt").'),
    },
  }, async ({ text, tags, source }) => fmt(await addFact({ text, tags, source: source || 'mcp' })));

  server.registerTool('memory_search', {
    title: 'Search shared memory',
    description: 'Find relevant facts from the shared memory. Call this at the start of a task to stay on the same page as the other assistants.',
    inputSchema: {
      query: z.string().describe('What to look for.'),
      limit: z.number().int().positive().max(50).optional(),
      tag: z.string().optional().describe('Restrict to a tag.'),
    },
  }, async ({ query, limit, tag }) => fmt(await searchFacts(query, { limit: limit || 10, tag: tag || null })));

  server.registerTool('memory_list', {
    title: 'List recent memory',
    description: 'List the most recently updated facts in the shared memory.',
    inputSchema: { limit: z.number().int().positive().max(200).optional() },
  }, async ({ limit }) => fmt(await listFacts({ limit: limit || 50 })));

  server.registerTool('memory_update', {
    title: 'Update a fact',
    description: 'Update an existing fact by id (e.g. to correct or refine it).',
    inputSchema: {
      id: z.string(),
      text: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
  }, async ({ id, text, tags }) => fmt(await updateFact(id, { text, tags })));

  server.registerTool('memory_delete', {
    title: 'Delete a fact',
    description: 'Remove a fact from shared memory by id.',
    inputSchema: { id: z.string() },
  }, async ({ id }) => fmt(await deleteFact(id)));

  server.registerTool('memory_stats', {
    title: 'Memory stats',
    description: 'How many facts are stored, and the tag breakdown.',
    inputSchema: {},
  }, async () => fmt(await stats()));

  return server;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : undefined); } catch { resolve(undefined); } });
  });
}

async function main() {
  if (process.argv.includes('--http')) {
    const PORT = Number(process.env.PORT) || 8787;
    const transports = {}; // sessionId -> transport (one memory server per live session)

    const httpServer = http.createServer(async (req, res) => {
      if (req.url && req.url.startsWith('/health')) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('ok');
      }
      if (!req.url || !req.url.startsWith('/mcp')) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('not found');
      }

      if (!authorized(req)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: null,
          error: { code: -32001, message: 'Unauthorized: missing or bad bearer token.' } }));
      }

      const sid = req.headers['mcp-session-id'];

      if (req.method === 'POST') {
        const body = await readBody(req);
        let transport = sid ? transports[sid] : undefined;
        if (!transport && !sid && body && body.method === 'initialize') {
          // New session: spin up a transport + its own memory server.
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => { transports[id] = transport; },
          });
          transport.onclose = () => { if (transport.sessionId) delete transports[transport.sessionId]; };
          await createServer().connect(transport);
        }
        if (!transport) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ jsonrpc: '2.0', id: body?.id ?? null,
            error: { code: -32000, message: 'No valid session; send an initialize request first.' } }));
        }
        return transport.handleRequest(req, res, body);
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        if (!sid || !transports[sid]) { res.writeHead(400); return res.end('invalid or missing session'); }
        return transports[sid].handleRequest(req, res);
      }

      res.writeHead(405).end();
    });
    httpServer.listen(PORT, () => console.error(`[shared-memory] MCP (streamable HTTP) on :${PORT}/mcp`));
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[shared-memory] MCP (stdio) ready');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
