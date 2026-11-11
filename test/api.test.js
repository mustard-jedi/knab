import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { buildApp } from '../server/app.js';
import { postDueRecurring } from '../server/ledger.js';

async function setup() {
  const db = openDb(':memory:');
  const app = await buildApp({ db, config: { logger: false, cookieSecure: false, trustProxy: false } });
  const client = (cookie, budgetId) => async (method, url, body) => {
    const res = await app.inject({
      method, url: `/api/v1${url}`, payload: body,
      headers: { ...(cookie ? { cookie } : {}), ...(budgetId ? { 'x-budget-id': String(budgetId) } : {}) },
    });
    return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.body, res };
  };
  const cookieOf = (res) => res.headers['set-cookie'].split(';')[0];

  const anon = client();
  const created = await anon('POST', '/setup', { username: 'dad', password: 'correct horse' });
  assert.equal(created.status, 200);
  const dadCookie = cookieOf(created.res);
  const b = await client(dadCookie)('POST', '/budgets', { name: 'Home', cutoff_day: 23 });
  assert.equal(b.status, 201);
  const dad = client(dadCookie, b.body.id);
  return { app, db, anon, client, cookieOf, dad, dadCookie, budgetId: b.body.id };
}

test('setup runs once and endpoints need a login', async () => {
  const { anon } = await setup();
  assert.equal((await anon('GET', '/status')).body.needs_setup, false);
  assert.equal((await anon('POST', '/setup', { username: 'evil', password: 'whatever123' })).status, 409);
  assert.equal((await anon('GET', '/accounts')).status, 401);
  assert.equal((await anon('POST', '/auth/login', { username: 'dad', password: 'wrong' })).status, 401);
  assert.equal((await anon('POST', '/auth/login', { username: 'nobody', password: 'wrong' })).status, 401);
});

test('envelope maths: ready to assign + available = account balances', async () => {
  const { dad } = await setup();
  await dad('POST', '/accounts', { name: 'Checking', opening_balance: 1000, opening_date: '2026-01-01' });
  await dad('POST', '/accounts', { name: 'Card', type: 'credit', opening_balance: -200, opening_date: '2026-01-01' });

  let budget = (await dad('GET', '/budget?period=2026-01')).body;
  assert.deepEqual(budget.period, { label: '2026-01', start: '2026-01-23', end: '2026-02-22' });
  assert.equal(budget.ready_to_assign, 800);

  assert.equal((await dad('PUT', '/budget/assign', { category: 'groceries', period: '2026-01', amount: 300 })).status, 200);
  const tx = await dad('POST', '/transactions', {
    date: '2026-01-25', amount: 42.5, type: 'expense', account: 'card', category: 'Groceries', payee: 'Market',
  });
  assert.equal(tx.status, 201);
  assert.equal(tx.body.signed_amount, -42.5);
  assert.equal(tx.body.account, 'Card');

  // A transfer must not change the budget at all.
  assert.equal((await dad('POST', '/transfers', { date: '2026-01-26', amount: 100, from_account: 'Checking', to_account: 'Card' })).status, 201);

  budget = (await dad('GET', '/budget?period=2026-01')).body;
  const groceries = budget.groups.flatMap((g) => g.categories).find((c) => c.name === 'Groceries');
  assert.deepEqual([groceries.assigned, groceries.activity, groceries.available], [300, -42.5, 257.5]);
  assert.equal(budget.ready_to_assign, 500);

  const accounts = (await dad('GET', '/accounts')).body;
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  assert.equal(total, 757.5);
  assert.equal(budget.ready_to_assign + budget.totals.available, total);

  // Unspent money rolls into the next period.
  const next = (await dad('GET', '/budget?period=2026-02')).body;
  const g2 = next.groups.flatMap((g) => g.categories).find((c) => c.name === 'Groceries');
  assert.deepEqual([g2.assigned, g2.activity, g2.available], [0, 0, 257.5]);
  assert.deepEqual([g2.last_assigned, g2.last_activity], [300, -42.5]);
  assert.equal(next.left_over, 257.5);
  assert.equal(budget.assigned_future, 0);
  assert.equal(tx.body.category_group, 'Everyday');

  // The previous period (Dec 23 - Jan 22) has no activity.
  const prev = (await dad('GET', '/budget?period=2025-12')).body;
  assert.equal(prev.groups.flatMap((g) => g.categories).find((c) => c.name === 'Groceries').activity, 0);
});

test('changing the cutoff re-buckets activity and keeps assignments', async () => {
  const { dad, client, dadCookie, budgetId } = await setup();
  await dad('POST', '/accounts', { name: 'Cash', opening_balance: 500, opening_date: '2026-01-01' });
  await dad('PUT', '/budget/assign', { category: 'Groceries', period: '2026-01', amount: 100 });
  await dad('POST', '/transactions', { date: '2026-01-10', amount: 30, type: 'expense', account: 'Cash', category: 'Groceries' });
  const find = (b) => b.groups.flatMap((g) => g.categories).find((c) => c.name === 'Groceries');

  assert.equal(find((await dad('GET', '/budget?period=2026-01')).body).activity, 0); // Jan 10 < Jan 23
  assert.equal((await client(dadCookie)('PATCH', `/budgets/${budgetId}`, { cutoff_day: 1 })).status, 200);
  const after = find((await dad('GET', '/budget?period=2026-01')).body);
  assert.deepEqual([after.assigned, after.activity, after.available], [100, -30, 70]);
});

test('transaction payload validation gives fixable messages', async () => {
  const { dad } = await setup();
  await dad('POST', '/accounts', { name: 'Checking' });
  const post = (body) => dad('POST', '/transactions', body);

  let r = await post({ amount: 5, type: 'expense', account: 'Chequing', category: 'Groceries' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'unknown_account');
  assert.deepEqual(r.body.valid_accounts, ['Checking']);

  r = await post({ amount: 5, type: 'expense', account: 'Checking', category: 'Food' });
  assert.equal(r.body.error, 'unknown_category');
  assert.ok(r.body.valid_categories.includes('Groceries'));

  r = await post({ amount: 5, type: 'expense', account: 'Checking' });
  assert.equal(r.body.error, 'category_required');

  r = await post({ amount: -5, type: 'expense', account: 'Checking', category: 'Groceries' });
  assert.equal(r.body.error, 'validation_error');
  assert.match(r.body.message, /greater than 0/);

  r = await post({ amount: 5, type: 'spend', account: 'Checking', category: 'Groceries' });
  assert.match(r.body.message, /must be one of: expense, income/);

  r = await post({ amount: 5, type: 'expense', account: 'Checking', category: 'Groceries', budget: 'Home' });
  assert.match(r.body.message, /Unknown field "budget"/);

  r = await post({ type: 'expense', account: 'Checking', category: 'Groceries' });
  assert.match(r.body.message, /Missing required field "amount"/);

  r = await post({ amount: 1.005, type: 'expense', account: 'Checking', category: 'Groceries' });
  assert.equal(r.body.error, 'invalid_amount');

  r = await post({ date: '2026-02-30', amount: 5, type: 'expense', account: 'Checking', category: 'Groceries' });
  assert.equal(r.body.error, 'invalid_date');

  // Strings that are numbers are accepted; date defaults to today.
  r = await post({ amount: '12.50', type: 'income', account: 'checking' });
  assert.equal(r.status, 201);
  assert.equal(r.body.amount, 12.5);
  assert.equal(r.body.category, null);
  assert.match(r.body.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('editing and deleting, including transfers', async () => {
  const { dad } = await setup();
  await dad('POST', '/accounts', { name: 'A', opening_balance: 100 });
  await dad('POST', '/accounts', { name: 'B' });
  const t = (await dad('POST', '/transactions', { amount: 10, type: 'expense', account: 'A', category: 'Groceries' })).body;
  let r = await dad('PATCH', `/transactions/${t.id}`, { amount: 15, category: 'Transport' });
  assert.equal(r.body.signed_amount, -15);
  assert.equal(r.body.category, 'Transport');
  r = await dad('PATCH', `/transactions/${t.id}`, { category: '' });
  assert.equal(r.body.error, 'category_required');

  const tr = (await dad('POST', '/transfers', { amount: 40, from_account: 'A', to_account: 'B' })).body;
  assert.equal(tr.type, 'transfer');
  assert.equal(tr.transfer_account, 'B');
  await dad('PATCH', `/transactions/${tr.id}`, { amount: 50 });
  let accounts = (await dad('GET', '/accounts')).body;
  assert.deepEqual(accounts.map((a) => a.balance), [35, 50]);
  assert.equal((await dad('PATCH', `/transactions/${tr.id}`, { account: 'B' })).status, 400);
  assert.equal((await dad('DELETE', `/accounts/${accounts[1].id}`)).status, 409);
  await dad('DELETE', `/transactions/${tr.id}`);
  accounts = (await dad('GET', '/accounts')).body;
  assert.deepEqual(accounts.map((a) => a.balance), [85, 0]);
  assert.equal((await dad('GET', '/transactions')).body.total, 2);
});

test('budgets are private until shared; tokens are scoped to one budget', async () => {
  const { dad, anon, client, cookieOf, dadCookie, budgetId, app } = await setup();
  await dad('POST', '/accounts', { name: 'Checking', opening_balance: 10 });
  assert.equal((await client(dadCookie)('POST', '/users', { username: 'kid', password: 'kidpassword' })).status, 201);
  const kidCookie = cookieOf((await anon('POST', '/auth/login', { username: 'kid', password: 'kidpassword' })).res);
  const kidNoBudget = client(kidCookie);
  const kid = client(kidCookie, budgetId);

  assert.deepEqual((await kidNoBudget('GET', '/budgets')).body, []);
  assert.equal((await kid('GET', '/accounts')).status, 404);
  assert.equal((await kid('GET', '/transactions')).status, 404);
  assert.equal((await kidNoBudget('GET', '/users')).status, 403);
  assert.equal((await kidNoBudget('PATCH', `/budgets/${budgetId}`, { cutoff_day: 5 })).status, 404);
  assert.equal((await kidNoBudget('POST', '/tokens', { name: 'x', budget_id: budgetId })).status, 404);

  assert.equal((await client(dadCookie)('POST', `/budgets/${budgetId}/members`, { username: 'kid' })).status, 201);
  assert.equal((await kid('GET', '/accounts')).status, 200);
  assert.equal((await kidNoBudget('DELETE', `/budgets/${budgetId}`)).status, 404);

  const token = (await kidNoBudget('POST', '/tokens', { name: 'phi', budget_id: budgetId })).body.token;
  const viaToken = (method, url, payload) => app.inject({ method, url: `/api/v1${url}`, payload, headers: { authorization: `Bearer ${token}` } });
  let res = await viaToken('POST', '/transactions', { amount: 3, type: 'expense', account: 'Checking', category: 'Dining Out' });
  assert.equal(res.statusCode, 201);
  assert.equal((await viaToken('GET', '/tokens')).statusCode, 403);
  assert.equal((await viaToken('POST', '/budgets', { name: 'Sneaky' })).statusCode, 403);
  res = await app.inject({ url: '/api/v1/accounts', headers: { authorization: 'Bearer knab_nope' } });
  assert.equal(res.statusCode, 401);

  // Un-sharing revokes access, including through the token.
  const kidId = (await client(dadCookie)('GET', '/users')).body.find((u) => u.username === 'kid').id;
  await client(dadCookie)('DELETE', `/budgets/${budgetId}/members/${kidId}`);
  assert.equal((await kid('GET', '/accounts')).status, 404);
  assert.equal((await viaToken('GET', '/accounts')).statusCode, 401);
});

test('recurring transactions post when due and stop at the end date', async () => {
  const { dad, db } = await setup();
  await dad('POST', '/accounts', { name: 'Checking' });
  const r = await dad('POST', '/recurring', {
    date: '2099-01-31', amount: 50, type: 'expense', account: 'Checking', category: 'Internet', frequency: 'monthly', end_date: '2099-04-15',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.posted_now, 0);
  assert.equal(r.body.schedule.next_date, '2099-01-31');

  assert.equal(postDueRecurring(db, '2099-01-30'), 0);
  assert.equal(postDueRecurring(db, '2099-03-01'), 2);
  assert.equal(postDueRecurring(db, '2099-03-01'), 0);
  assert.equal((await dad('GET', '/recurring')).body[0].next_date, '2099-03-31');
  assert.equal(postDueRecurring(db, '2099-12-31'), 1);
  assert.deepEqual((await dad('GET', '/recurring')).body, []);
  const dates = (await dad('GET', '/transactions?from=2099-01-01')).body.transactions.map((t) => t.date);
  assert.deepEqual(dates, ['2099-03-31', '2099-02-28', '2099-01-31']);

  // A schedule that starts in the past posts immediately.
  const past = await dad('POST', '/recurring', { date: '2020-01-01', amount: 5, type: 'income', account: 'Checking', frequency: 'yearly', end_date: '2021-06-01' });
  assert.equal(past.body.posted_now, 2);
  assert.equal(past.body.schedule, null);
});

test('reports and schema docs', async () => {
  const { dad, anon, app } = await setup();
  await dad('POST', '/accounts', { name: 'Checking', opening_balance: 1000, opening_date: '2026-01-01' });
  await dad('POST', '/transactions', { date: '2026-01-24', amount: 2000, type: 'income', account: 'Checking' });
  await dad('POST', '/transactions', { date: '2026-01-25', amount: 60, type: 'expense', account: 'Checking', category: 'Groceries' });
  await dad('POST', '/transactions', { date: '2026-01-26', amount: 40, type: 'expense', account: 'Checking', category: 'Transport' });

  const spending = (await dad('GET', '/reports/spending?from=2026-01-23&to=2026-02-22')).body;
  assert.equal(spending.total, 100);
  assert.deepEqual(spending.categories.map((c) => [c.category, c.spent]), [['Groceries', 60], ['Transport', 40]]);

  const trend = (await dad('GET', '/reports/trend?count=2&end=2026-01')).body.periods;
  assert.equal(trend.length, 2);
  assert.deepEqual([trend[1].income, trend[1].spending, trend[1].net_worth], [2000, 100, 2900]);
  assert.deepEqual([trend[0].income, trend[0].net_worth], [0, 1000]); // opening balance is not income

  const flow = (await dad('GET', '/reports/flow?start=2025-12&end=2026-01')).body;
  assert.deepEqual(flow.periods.map((p) => p.label), ['2025-12', '2026-01']);
  assert.equal(flow.days, 62);
  assert.deepEqual(flow.categories.map((c) => [c.category, c.amounts, c.total, c.count]), [['Groceries', [0, 60], 60, 1], ['Transport', [0, 40], 40, 1]]);
  assert.deepEqual(flow.income, [{ payee: 'No payee', amounts: [0, 2000], total: 2000 }]);
  assert.equal(flow.largest_outflow.amount, 60);
  const one = (await dad('GET', '/reports/flow?end=2026-01&category=Transport')).body;
  assert.deepEqual(one.categories.map((c) => c.category), ['Transport']);
  assert.equal((await dad('GET', '/reports/flow?start=2026-02&end=2026-01')).status, 400);

  // Both expenses used the 1000 opening balance from Jan 1: 24 and 25 days old.
  const age = (await dad('GET', '/reports/age?count=2&end=2026-01')).body;
  assert.deepEqual(age.periods.map((p) => p.age), [null, 25]);
  assert.equal(age.current, 25);

  const csv = (await dad('GET', '/export/transactions.csv')).body;
  assert.equal(csv.trim().split('\n').length, 5);

  const schema = (await anon('GET', '/schema/transaction')).body;
  assert.deepEqual(schema.required, ['amount', 'type', 'account']);
  assert.equal(schema.additionalProperties, false);
  const openapi = (await anon('GET', '/openapi.json')).body;
  assert.ok(openapi.paths['/api/v1/transactions'].post);
  assert.equal(openapi.paths['/api/v1/users'], undefined);
  assert.equal((await app.inject({ url: '/api/docs/' })).statusCode, 200);
});
