// End-to-end check: act as an MCP client (like Claude/Muse/ChatGPT would),
// connect to our server over stdio, and exercise the memory tools.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'node', args: ['src/mcp/server.mjs'] });
const client = new Client({ name: 'smoke-test', version: '1.0.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));

const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return JSON.parse(r.content[0].text);
};

console.log('\n-- memory_add (as muse) --');
console.log(await call('memory_add', { text: 'Leon has an iPhone, not an Android.', tags: ['device'], source: 'muse' }));
console.log(await call('memory_add', { text: 'Leon prefers black pill-shaped buttons, not blue.', tags: ['ui-pref'], source: 'claude' }));

console.log('\n-- memory_add dedupe (near-identical) --');
console.log(await call('memory_add', { text: 'Leon uses an iPhone (not Android).', tags: ['device'], source: 'chatgpt' }));

console.log('\n-- memory_search "what phone does leon use" (as chatgpt) --');
console.log(await call('memory_search', { query: 'what phone does leon use' }));

console.log('\n-- memory_stats --');
console.log(await call('memory_stats', {}));

await client.close();
