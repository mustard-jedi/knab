import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { buildApp } from '../server/app.js';
import { createMcpServer, ApiError } from '../bin/knab-mcp.js';

// An MCP server whose API calls go straight into an in-memory Knab, using a real token.
async function setup(options = {}) {
  const db = openDb(':memory:');
  const app = await buildApp({ db, config: { logger: false, cookieSecure: false, trustProxy: false } });
  const created = await app.inject({ method: 'POST', url: '/api/v1/setup', payload: { username: 'dad', password: 'correct horse' } });
  const cookie = created.headers['set-cookie'].split(';')[0];
  const budget = (await app.inject({ method: 'POST', url: '/api/v1/budgets', payload: { name: 'Home' }, headers: { cookie } })).json();
  const { token } = (await app.inject({ method: 'POST', url: '/api/v1/tokens', payload: { name: 'mcp', budget_id: budget.id }, headers: { cookie } })).json();
  await app.inject({ method: 'POST', url: '/api/v1/accounts', payload: { name: 'Checking', opening_balance: 500 }, headers: { authorization: `Bearer ${token}` } });
  const api = async (method, route, body) => {
    const res = await app.inject({ method, url: `/api/v1${route}`, payload: body, headers: { authorization: `Bearer ${token}` } });
    const data = res.headers['content-type'].includes('json') ? res.json() : res.body;
    if (res.statusCode >= 400) throw new ApiError(`Error (${data.error}): ${data.message}`);
    return data;
  };
  const handle = createMcpServer({ api, version: '1.2.3', ...options });
  let id = 0;
  const rpc = async (method, params) => handle({ jsonrpc: '2.0', id: ++id, method, params });
  const tool = async (name, args) => {
    const { result } = await rpc('tools/call', { name, arguments: args });
    const raw = result.content[0].text;
    let data = raw;
    if (!result.isError) { try { data = JSON.parse(raw); } catch { /* plain text */ } }
    return { ...result, data };
  };
  return { handle, rpc, tool };
}

test('mcp: handshake, tool list and protocol errors', async () => {
  const { handle, rpc } = await setup();
  const init = (await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } })).result;
  assert.equal(init.protocolVersion, '2025-03-26');
  assert.deepEqual(init.capabilities, { tools: {} });
  assert.equal(init.serverInfo.version, '1.2.3');
  assert.equal((await rpc('initialize', { protocolVersion: '2099-01-01' })).result.protocolVersion, '2025-06-18');

  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.deepEqual((await rpc('ping')).result, {});

  const { tools } = (await rpc('tools/list')).result;
  assert.ok(tools.length >= 12);
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.ok(t.description.length > 20);
  }
  assert.equal(tools.find((t) => t.name === 'list_accounts').annotations.readOnlyHint, true);
  assert.equal(tools.find((t) => t.name === 'add_transaction').annotations.readOnlyHint, false);
  assert.equal(tools.some((t) => /delete/.test(t.name)), false);

  assert.equal((await rpc('nope/nothing')).error.code, -32601);
  assert.equal((await rpc('tools/call', { name: 'drop_everything', arguments: {} })).error.code, -32602);
  assert.equal((await handle({ id: 9, method: 'ping' })).error.code, -32600);
});

test('mcp: tools read and write through the API', async () => {
  const { tool } = await setup();
  assert.deepEqual((await tool('list_accounts', {})).data.map((a) => [a.name, a.balance]), [['Checking', 500]]);
  assert.ok((await tool('list_categories', {})).data.some((g) => g.categories.includes('Groceries')));

  const added = await tool('add_transaction', { amount: 42.5, type: 'expense', account: 'checking', category: 'Groceries', payee: 'Market', flag: 'Red' });
  assert.equal(added.data.signed_amount, -42.5);
  assert.equal(added.data.flag, 'Red');

  // A wrong name is a tool result the model can read and fix, not a protocol error.
  const wrong = await tool('add_transaction', { amount: 5, type: 'expense', account: 'Chequing', category: 'Groceries' });
  assert.equal(wrong.isError, true);
  assert.match(wrong.data, /unknown_account.*Valid accounts: Checking/);

  const listed = await tool('list_transactions', { search: 'market' });
  assert.equal(listed.data.total, 1);
  const updated = await tool('update_transaction', { id: added.data.id, cleared: true, memo: 'weekly shop' });
  assert.deepEqual([updated.data.cleared, updated.data.memo, updated.data.flag], [true, 'weekly shop', 'Red']);

  await tool('assign_budget', { category: 'Groceries', amount: 100 });
  const budget = (await tool('get_budget', {})).data;
  const groceries = budget.groups.flatMap((g) => g.categories).find((c) => c.name === 'Groceries');
  assert.deepEqual([groceries.assigned, groceries.activity, groceries.available], [100, -42.5, 57.5]);
  assert.equal(budget.ready_to_assign, 400);

  assert.equal((await tool('spending_report', {})).data.categories[0].total, 42.5);
  assert.equal((await tool('net_worth_report', { periods: 2 })).data.periods.length, 2);
  assert.ok((await tool('list_flags', {})).data.find((f) => f.name === 'Red').transactions === 1);
});

test('mcp: the manual can be listed and searched', async () => {
  const { tool } = await setup();
  const outline = (await tool('read_manual', {})).data;
  assert.match(outline, /Flags/);
  assert.match(outline, /What is Ready to Assign\?/);
  assert.ok(outline.length < 12000);

  const overspend = (await tool('read_manual', { topic: 'overspend a category' })).data;
  assert.match(overspend, /### What happens when I overspend a category\?/);
  assert.match(overspend, /carries into the\s+next period/);
  assert.match((await tool('read_manual', { topic: 'reorder categories' })).data, /Drag the grip/);
  assert.match((await tool('read_manual', { topic: 'zzzz' })).data, /Nothing in the manual matches/);
});

test('mcp: read-only mode leaves out every tool that changes data', async () => {
  const { rpc } = await setup({ readOnly: true });
  const { tools } = (await rpc('tools/list')).result;
  assert.ok(tools.length >= 8);
  assert.ok(tools.every((t) => t.annotations.readOnlyHint));
  assert.equal((await rpc('tools/call', { name: 'add_transaction', arguments: { amount: 1, type: 'income', account: 'Checking' } })).error.code, -32602);
});
