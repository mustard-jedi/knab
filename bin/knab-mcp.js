#!/usr/bin/env node
// Model Context Protocol server for Knab, over stdio. No dependencies; needs Node 20+.
//
// It is a thin wrapper around the REST API: every tool call becomes one HTTP
// request made with your API token, so it can do exactly what that token can.
// Configuration is the same as the knab command: KNAB_URL and KNAB_TOKEN, or
// ~/.config/knab/config.json. Set KNAB_MCP_READONLY=1 to leave out the tools
// that change data.
//
// The stdio transport is one JSON-RPC message per line. stdout carries only
// protocol messages; anything for a human goes to stderr.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const date = (what) => str(`${what}, as YYYY-MM-DD.`);
const period = str('Budget period label YYYY-MM (the month the period starts in). Defaults to the current period.');
const amount = { type: 'number', exclusiveMinimum: 0, description: 'Positive number with at most 2 decimals. Never negative.' };
const query = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString();
  return s ? `?${s}` : '';
};
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });

const entryFields = {
  amount,
  type: str('"expense" = money spent, "income" = money received.', { enum: ['expense', 'income'] }),
  account: str('Account name, from list_accounts. Not case-sensitive.'),
  category: str('Category name, from list_categories. Required for an expense. Leave out for income so it goes to Ready to Assign.'),
  date: date('Date of the transaction; defaults to today'),
  payee: str('Who was paid, or who paid.'),
  memo: str('Free-text note.'),
  cleared: { type: 'boolean', description: 'true if it has settled at the bank.' },
  flag: str('Flag name, from list_flags. An empty string removes the flag.'),
};

// Each tool: what the model sees, and how it maps onto one API request.
const TOOLS = [
  {
    name: 'read_manual',
    description: 'Read the Knab user manual: how the app and its budgeting model work, written as questions and answers. Use it for "how do I..." and "what does ... mean" questions. Pass a topic to get only the matching sections; with no topic it returns the list of questions.',
    inputSchema: object({ topic: str('Words to look for, for example "flags", "overspend" or "share budget". Leave out to list every question in the manual.') }),
    run: async (api, a) => manualSections(await api('GET', '/manual'), a.topic),
  },
  {
    name: 'list_accounts',
    description: 'List the accounts in the budget with their type and current balance. Call this before adding a transaction if you are unsure of the account name.',
    inputSchema: object({}),
    run: async (api) => (await api('GET', '/accounts')).map(({ name, type, balance, cleared_balance, closed }) => ({ name, type, balance, cleared_balance, closed })),
  },
  {
    name: 'list_categories',
    description: 'List the budget category groups and the categories in each. Expenses must use one of these category names.',
    inputSchema: object({}),
    run: async (api) => (await api('GET', '/categories')).map((g) => ({ group: g.name, categories: g.categories.filter((c) => !c.hidden).map((c) => c.name) })),
  },
  {
    name: 'list_flags',
    description: 'List the coloured flags that can be put on a transaction. The one marked review_flag is for transactions whose category you had to guess.',
    inputSchema: object({}),
    run: async (api) => (await api('GET', '/flags')).map(({ name, color, count, review }) => ({ name, color, transactions: count, ...(review ? { review_flag: true } : {}) })),
  },
  {
    name: 'get_budget',
    description: 'Show the envelope budget for one period: Ready to Assign, and assigned, activity and available for every category. Activity is negative for spending.',
    inputSchema: object({ period }),
    run: (api, a) => api('GET', `/budget${query({ period: a.period })}`),
  },
  {
    name: 'list_transactions',
    description: 'List transactions, newest first, with optional filters. Each has an id that update_transaction needs. signed_amount is negative for money leaving the account.',
    inputSchema: object({
      account: str('Only this account (by name).'),
      category: str('Only this category (by name).'),
      flag: str('Only transactions with this flag (by name).'),
      from: date('Earliest date'),
      to: date('Latest date'),
      search: str('Text to look for in payee, memo and category.'),
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'How many to return. Defaults to 20.' },
    }),
    run: (api, a) => api('GET', `/transactions${query({ account: a.account, category: a.category, flag: a.flag, from: a.from, to: a.to, q: a.search, limit: a.limit ?? 20 })}`),
  },
  {
    name: 'spending_report',
    description: 'Spending per category and income per payee, one column per budget period. Use it for questions like "how much did we spend on groceries the last 3 periods".',
    inputSchema: object({
      start: str('Label YYYY-MM of the first period. Defaults to "end".'),
      end: str('Label YYYY-MM of the last period. Defaults to the current period.'),
      account: str('Only this account (by name).'),
      category: str('Only spending in this category (by name).'),
      group: str('Only spending in this category group (by name).'),
    }),
    run: (api, a) => api('GET', `/reports/flow${query({ start: a.start, end: a.end, account: a.account, category: a.category, group: a.group })}`),
  },
  {
    name: 'net_worth_report',
    description: 'Income, spending, assets, debts and net worth at the end of each of the last N budget periods.',
    inputSchema: object({ periods: { type: 'integer', minimum: 1, maximum: 36, description: 'How many periods, ending with the current one. Defaults to 12.' } }),
    run: (api, a) => api('GET', `/reports/trend${query({ count: a.periods ?? 12 })}`),
  },
  {
    name: 'get_forecast',
    description: 'What is planned for the coming budget periods: installments, ongoing bills, one-off expenses and expected income, with totals per period, what is already assigned, the items that are overdue or due today, and the debt still committed in installments. Use it for "what is coming up", "how much do I still owe on installments" and "when does it ease".',
    inputSchema: object({ periods: { type: 'integer', minimum: 1, maximum: 36, description: 'How many periods, starting with the current one. Defaults to 6.' } }),
    run: (api, a) => api('GET', `/forecast${query({ periods: a.periods ?? 6 })}`),
  },
  {
    name: 'add_planned_item',
    write: true,
    description: 'Plan a future expense or income in the forecast: an installment (set "payments", and "payments_left" if some are already paid), an ongoing bill or salary (leave "payments" out), or a one-off (payments 1). It does not create a transaction now; by default it waits until the user enters each payment.',
    inputSchema: object({
      name: str('What it is, for example "Laptop installment".'),
      amount,
      type: entryFields.type,
      account: entryFields.account,
      category: entryFields.category,
      date: date('Date of the next payment'),
      frequency: str('How often it repeats. Use "monthly" for a one-off.', { enum: ['weekly', 'biweekly', 'monthly', 'yearly'] }),
      payments: { type: 'integer', minimum: 0, maximum: 600, description: 'Payments in all: 12 for a 12-month installment, 1 for a one-off. Leave out for something with no end.' },
      payments_left: { type: 'integer', minimum: 1, maximum: 600, description: 'Payments still to go, if fewer than "payments".' },
      is_debt: { type: 'boolean', description: 'true if the remaining payments are a debt already owed, such as an installment already charged to a card.' },
      auto: { type: 'boolean', description: 'true enters each payment automatically on its date. Defaults to false: wait for the user.' },
      memo: entryFields.memo,
    }, ['name', 'amount', 'type', 'account', 'date', 'frequency']),
    run: (api, a) => api('POST', '/recurring', { auto: false, ...a }),
  },
  {
    name: 'add_transaction',
    write: true,
    description: 'Record one expense or income transaction. Amount is always positive; "type" says which way the money went. If a name is wrong the error lists the valid names. For a wrong category: ask the user if you can; otherwise retry with the closest valid category, set the review flag named in the error, and start the memo with the original wording. Never guess an account.',
    inputSchema: object(entryFields, ['amount', 'type', 'account']),
    run: (api, a) => api('POST', '/transactions', a),
  },
  {
    name: 'add_transfer',
    write: true,
    description: 'Move money between two of the budget\'s own accounts, for example paying a credit card from checking.',
    inputSchema: object({
      amount,
      from_account: str('Name of the account the money leaves.'),
      to_account: str('Name of the account the money enters.'),
      date: date('Date of the transfer; defaults to today'),
      memo: entryFields.memo,
      flag: entryFields.flag,
    }, ['amount', 'from_account', 'to_account']),
    run: (api, a) => api('POST', '/transfers', a),
  },
  {
    name: 'update_transaction',
    write: true,
    description: 'Change an existing transaction. Send its id (from list_transactions) and only the fields to change. It cannot delete a transaction.',
    inputSchema: object({ id: { type: 'integer', description: 'Transaction id.' }, ...entryFields }, ['id']),
    run: (api, { id, ...changes }) => api('PATCH', `/transactions/${encodeURIComponent(id)}`, changes),
  },
  {
    name: 'assign_budget',
    write: true,
    description: 'Set the total amount assigned to a category for a period. This replaces the previous amount; it does not add to it.',
    inputSchema: object({
      category: str('Category name, from list_categories.'),
      amount: { type: 'number', description: 'New total assigned for the period. 0 clears it.' },
      period,
    }, ['category', 'amount']),
    run: (api, a) => api('PUT', '/budget/assign', a),
  },
];

// The manual is Markdown with "## chapter" and "### question" headings. With no
// topic, return the outline; otherwise the questions that match best.
export function manualSections(markdown, topic) {
  const sections = [];
  let chapter = '';
  for (const line of String(markdown).split('\n')) {
    if (line.startsWith('## ')) { chapter = line.slice(3).trim(); sections.push({ chapter, title: chapter, body: [] }); }
    else if (line.startsWith('### ')) sections.push({ chapter, title: line.slice(4).trim(), body: [] });
    else if (sections.length) sections[sections.length - 1].body.push(line);
  }
  const words = String(topic || '').toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 2) || [];
  if (!words.length) {
    const outline = [];
    for (const s of sections) outline.push(s.title === s.chapter ? `\n${s.chapter}` : `  - ${s.title}`);
    return `Knab manual: questions it answers. Call read_manual again with a topic to read the answers.\n${outline.join('\n')}`;
  }
  const scored = sections.map((s) => {
    const title = `${s.chapter} ${s.title}`.toLowerCase();
    const body = s.body.join(' ').toLowerCase();
    return { s, score: words.reduce((n, w) => n + (title.includes(w) ? 3 : 0) + (body.includes(w) ? 1 : 0), 0) };
  }).filter((x) => x.score > 0 && x.s.body.join('').trim()).sort((a, b) => b.score - a.score).slice(0, 6);
  if (!scored.length) return `Nothing in the manual matches "${topic}". Call read_manual with no topic to see what it covers.`;
  return scored.map(({ s }) => `### ${s.title} (${s.chapter})\n${s.body.join('\n').trim()}`).join('\n\n');
}

const INSTRUCTIONS = 'Knab is a household envelope budget. Accounts, categories and flags are referred to by name, not id. '
  + 'Amounts are always positive numbers; "type" (expense or income) gives the direction. '
  + 'Budget periods are labelled YYYY-MM after the month they start in and may not match calendar months. '
  + 'For questions about how Knab works, call read_manual instead of guessing. '
  + 'Before writing, confirm anything the user did not state (which account, which category) rather than guessing. '
  + 'If a category you were given does not exist and nobody can be asked, use the closest valid category, set the review flag (list_flags marks it), and start the memo with the wording you were given. '
  + 'Never guess an account and never invent a category.';

class ApiError extends Error {}

// `api(method, route, body)` resolves to the parsed response or throws ApiError.
export function createMcpServer({ api, readOnly = false, version = '0.0.0' }) {
  const tools = TOOLS.filter((t) => !(readOnly && t.write));
  const listed = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: !t.write, destructiveHint: false, openWorldHint: false },
  }));
  const text = (value, isError = false) => ({
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  });

  async function dispatch(method, params = {}) {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'knab', title: 'Knab budget', version },
          instructions: INSTRUCTIONS,
        };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: listed };
      case 'tools/call': {
        const tool = tools.find((t) => t.name === params.name);
        if (!tool) throw Object.assign(new Error(`Unknown tool: ${params.name}`), { rpc: -32602 });
        try {
          return text(await tool.run(api, params.arguments || {}));
        } catch (err) {
          // Failures the model can act on (a wrong name, a bad date) come back as tool results.
          if (err instanceof ApiError) return text(err.message, true);
          throw err;
        }
      }
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { rpc: -32601 });
    }
  }

  // Takes one parsed JSON-RPC message; resolves to the reply, or null for a notification.
  return async function handle(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      // Replies to requests we never send, and other noise, are ignored.
      if (message && message.method === undefined) return null;
      return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
    }
    if (message.id === undefined) return null;
    try {
      return { jsonrpc: '2.0', id: message.id, result: await dispatch(message.method, message.params) };
    } catch (err) {
      return { jsonrpc: '2.0', id: message.id, error: { code: err.rpc || -32603, message: err.message } };
    }
  };
}

export { ApiError };

function httpApi() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'knab', 'config.json'), 'utf8'));
  } catch { /* optional */ }
  const url = (process.env.KNAB_URL || file.url || 'http://localhost:3000').replace(/\/+$/, '');
  const token = process.env.KNAB_TOKEN || file.token;
  return async (method, route, body) => {
    if (!token) throw new ApiError('Knab has no API token configured. Ask the user to create one under Settings > API tokens and set KNAB_TOKEN for this MCP server.');
    let res;
    try {
      res = await fetch(`${url}/api/v1${route}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ApiError(`Could not reach the Knab server at ${url}: ${err.cause?.message || err.message}`);
    }
    const raw = await res.text();
    let data = raw;
    if ((res.headers.get('content-type') || '').includes('json')) { try { data = JSON.parse(raw); } catch { data = {}; } }
    if (!res.ok) throw new ApiError(`Error (${data.error || res.status}): ${data.message || res.statusText}${data.hint ? ` ${data.hint}` : ''}`);
    return data;
  };
}

export function runStdio() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let version = '0.0.0';
  try { version = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version; } catch { /* copied without package.json */ }
  const readOnly = ['1', 'true', 'yes'].includes(String(process.env.KNAB_MCP_READONLY || '').toLowerCase());
  const handle = createMcpServer({ api: httpApi(), readOnly, version });
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
  console.error(`knab mcp: ready${readOnly ? ' (read-only)' : ''}`);
  // One message at a time, in the order received, so a read that follows a
  // write always sees it.
  let queue = Promise.resolve();
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }
      const reply = await handle(message);
      if (reply) send(reply);
    }).catch((err) => console.error(`knab mcp: ${err.message}`));
  });
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) runStdio();
