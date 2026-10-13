// Prove the REMOTE path: connect over streamable HTTP exactly like Muse/ChatGPT
// would when given the connector URL.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.env.MCP_URL || 'http://localhost:8787/mcp');
const token = process.env.MCP_TOKEN;
const transport = new StreamableHTTPClientTransport(url,
  token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined);
const client = new Client({ name: 'remote-smoke', version: '1.0.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log('REMOTE TOOLS:', tools.tools.map((t) => t.name).join(', '));

const r = await client.callTool({ name: 'memory_stats', arguments: {} });
console.log('REMOTE memory_stats ->', r.content[0].text);

const s = await client.callTool({ name: 'memory_search', arguments: { query: 'phone' } });
console.log('REMOTE memory_search "phone" ->', s.content[0].text);

await client.close();
console.log('OK: remote MCP over HTTP works.');
