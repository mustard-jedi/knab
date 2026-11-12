#!/usr/bin/env node
// Command-line client for the Knab API. No dependencies; needs Node 20+.
//
//   export KNAB_URL=http://localhost:3000
//   export KNAB_TOKEN=knab_...            (create one under Settings > API tokens)
//   knab add --amount 12.50 --type expense --account Checking --category Groceries
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const HELP = `Usage: knab <command> [options]

Commands
  add         Create a transaction
                --amount 12.50            positive number (required)
                --type expense|income     (required)
                --account NAME            (required)
                --category NAME           required for an expense
                --payee TEXT  --memo TEXT  --date YYYY-MM-DD  --cleared  --flag NAME
  transfer    Move money between accounts
                --amount 100 --from NAME --to NAME [--date YYYY-MM-DD] [--memo TEXT]
  accounts    List accounts and balances
  categories  List categories
  budget      Show the budget [--period YYYY-MM]
  recent      List recent transactions [--limit 20]
  schema      Print the JSON Schema for "add"
  mcp         Run as a Model Context Protocol server on stdio (for Claude and other MCP clients)

Configuration
  KNAB_URL    Server address (default http://localhost:3000)
  KNAB_TOKEN  API token
  Both can also be put in ~/.config/knab/config.json as {"url": "...", "token": "..."}.

Output is JSON. The exit code is 0 on success and 1 on any error.`;

function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'knab', 'config.json'), 'utf8'));
  } catch { /* optional */ }
  return {
    url: (process.env.KNAB_URL || file.url || 'http://localhost:3000').replace(/\/+$/, ''),
    token: process.env.KNAB_TOKEN || file.token,
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function call(method, route, body, needsToken = true) {
  const { url, token } = loadConfig();
  if (needsToken && !token) fail('No API token. Set KNAB_TOKEN (create a token under Settings > API tokens).');
  let res;
  try {
    res = await fetch(`${url}/api/v1${route}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    fail(`Could not reach ${url}: ${err.cause?.message || err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) fail(`Error (${data.error || res.status}): ${data.message || res.statusText}`);
  return data;
}

const [command, ...rest] = process.argv.slice(2);
const options = {
  amount: { type: 'string' }, type: { type: 'string' }, account: { type: 'string' }, category: { type: 'string' },
  payee: { type: 'string' }, memo: { type: 'string' }, date: { type: 'string' }, cleared: { type: 'boolean' }, flag: { type: 'string' },
  from: { type: 'string' }, to: { type: 'string' }, period: { type: 'string' }, limit: { type: 'string' },
};

let args;
try {
  args = parseArgs({ args: rest, options }).values;
} catch (err) {
  fail(`${err.message}\n\n${HELP}`);
}

const number = (name) => {
  const n = Number(args[name]);
  if (args[name] === undefined || Number.isNaN(n)) fail(`--${name} must be a number, for example 12.50`);
  return n;
};
const pick = (...names) => Object.fromEntries(names.filter((n) => args[n] !== undefined).map((n) => [n, args[n]]));
const print = (data) => console.log(JSON.stringify(data, null, 2));

switch (command) {
  case 'add':
    for (const required of ['type', 'account']) if (!args[required]) fail(`--${required} is required`);
    print(await call('POST', '/transactions', { ...pick('type', 'account', 'category', 'payee', 'memo', 'date', 'cleared', 'flag'), amount: number('amount') }));
    break;
  case 'transfer':
    for (const required of ['from', 'to']) if (!args[required]) fail(`--${required} is required`);
    print(await call('POST', '/transfers', { ...pick('date', 'memo'), amount: number('amount'), from_account: args.from, to_account: args.to }));
    break;
  case 'accounts':
    print((await call('GET', '/accounts')).map(({ name, type, balance, closed }) => ({ name, type, balance, closed })));
    break;
  case 'categories':
    print((await call('GET', '/categories')).map((g) => ({ group: g.name, categories: g.categories.filter((c) => !c.hidden).map((c) => c.name) })));
    break;
  case 'budget':
    print(await call('GET', `/budget${args.period ? `?period=${encodeURIComponent(args.period)}` : ''}`));
    break;
  case 'recent':
    print((await call('GET', `/transactions?limit=${args.limit ? number('limit') : 20}`)).transactions);
    break;
  case 'mcp': {
    // Lives in its own file so this one stays copyable on its own.
    const { runStdio } = await import('./knab-mcp.js').catch(() => fail('knab mcp needs knab-mcp.js next to knab.js.'));
    runStdio();
    break;
  }
  case 'schema':
    print(await call('GET', '/schema/transaction', null, false));
    break;
  case undefined:
  case 'help':
  case '--help':
  case '-h':
    console.log(HELP);
    break;
  default:
    fail(`Unknown command "${command}".\n\n${HELP}`);
}
