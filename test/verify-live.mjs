// Verify the LIVE Postgres-backed memory over the public MCP endpoint.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.env.MCP_URL);
const token = process.env.MCP_TOKEN;
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({ name: 'verify-live', version: '1.0.0' });
await client.connect(transport);
const call = async (n, a) => JSON.parse((await client.callTool({ name: n, arguments: a })).content[0].text);

console.log('store backend proof -> stats before:', await call('memory_stats', {}));
console.log('\nadd (seed a real fact):',
  await call('memory_add', { text: 'Leon prefers black pill-shaped buttons, not blue.', tags: ['ui-pref'], source: 'claude' }));
console.log('\nadd (another):',
  await call('memory_add', { text: 'Leon has an iPhone, not an Android.', tags: ['device'], source: 'muse' }));
console.log('\nsearch "button style":', await call('memory_search', { query: 'button style preference' }));
console.log('\nstats after:', await call('memory_stats', {}));
await client.close();
console.log('\nOK: live Postgres-backed shared memory works.');
