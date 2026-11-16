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

test('categories and groups can be reordered and moved between groups', async () => {
  const { dad, client, dadCookie } = await setup();
  const before = (await dad('GET', '/categories')).body;
  const [first, second] = before;
  const moved = first.categories[0];
  const layout = [
    { id: second.id, categories: [moved.id, ...second.categories.map((c) => c.id).reverse()] },
    { id: first.id, categories: first.categories.slice(1).map((c) => c.id) },
    ...before.slice(2).map((g) => ({ id: g.id, categories: g.categories.map((c) => c.id) })),
  ];
  assert.equal((await dad('PUT', '/categories/order', { groups: layout })).status, 200);
  const after = (await dad('GET', '/categories')).body;
  assert.deepEqual(after.map((g) => g.id), layout.map((g) => g.id));
  assert.deepEqual(after[0].categories.map((c) => c.id), layout[0].categories);
  assert.deepEqual((await dad('GET', '/budget')).body.groups[0].categories.map((c) => c.id), layout[0].categories);

  assert.equal((await dad('PUT', '/categories/order', { groups: [{ id: first.id, categories: [moved.id, moved.id] }] })).body.error, 'duplicate_id');
  // Ids from another budget are refused.
  const other = await client(dadCookie)('POST', '/budgets', { name: 'Other' });
  const foreign = (await client(dadCookie, other.body.id)('GET', '/categories')).body[0];
  assert.equal((await dad('PUT', '/categories/order', { groups: [{ id: foreign.id, categories: [] }] })).body.error, 'unknown_id');
  assert.equal((await dad('PUT', '/categories/order', { groups: [{ id: first.id, categories: [foreign.categories[0].id] }] })).body.error, 'unknown_id');
});

test('a budget survives export and import intact', async () => {
  const { dad, client, dadCookie, budgetId, app, anon } = await setup();
  await dad('POST', '/accounts', { name: 'Checking', opening_balance: 1000, opening_date: '2026-01-01' });
  await dad('POST', '/accounts', { name: 'Visa', type: 'credit', opening_balance: -200, opening_date: '2026-01-01' });
  await dad('POST', '/flags', { name: 'Owed', color: 'teal' });
  await dad('POST', '/transactions', { date: '2026-01-25', amount: 60, type: 'expense', account: 'Checking', category: 'Groceries', payee: 'Market', memo: 'weekly', cleared: true, flag: 'Owed' });
  await dad('POST', '/transactions', { date: '2026-01-26', amount: 2000, type: 'income', account: 'Checking', payee: 'Employer' });
  await dad('POST', '/transfers', { date: '2026-01-27', amount: 150, from_account: 'Checking', to_account: 'Visa', memo: 'card' });
  await dad('PUT', '/budget/assign', { category: 'Groceries', period: '2026-01', amount: 300 });
  await dad('POST', '/recurring', { date: '2099-01-31', amount: 15, type: 'expense', account: 'Visa', category: 'Internet', frequency: 'monthly' });
  const hide = (await dad('GET', '/categories')).body[0].categories[1];
  await dad('PATCH', `/categories/${hide.id}`, { hidden: true });

  const file = (await dad('GET', '/export/budget.json')).body;
  assert.deepEqual([file.format, file.version, file.budget.cutoff_day], ['knab-budget', 1, 23]);
  assert.equal(JSON.stringify(file).includes('"id"'), false);

  const me = client(dadCookie);
  const imported = await me('POST', '/budgets/import', file);
  assert.equal(imported.status, 201);
  assert.equal(imported.body.name, 'Home (imported)');
  assert.notEqual(imported.body.id, budgetId);
  assert.deepEqual(imported.body.imported, { accounts: 2, categories: 10, transactions: 6 });
  assert.equal((await me('POST', '/budgets/import', file)).body.name, 'Home (imported 2)');

  // Everything that matters reads the same from the copy as from the original.
  const copy = client(dadCookie, imported.body.id);
  const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (['id', 'recurring_id', 'exported_at', 'name'].includes(k) && typeof x !== 'string' ? undefined : x)));
  const same = async (url) => assert.deepEqual(strip((await copy('GET', url)).body), strip((await dad('GET', url)).body), url);
  await same('/accounts');
  await same('/categories');
  await same('/flags');
  await same('/transactions?limit=100');
  await same('/budget?period=2026-01');
  await same('/recurring');
  const again = (await copy('GET', '/export/budget.json')).body;
  assert.deepEqual({ ...again, exported_at: 0, budget: 0 }, { ...file, exported_at: 0, budget: 0 });

  // The original is untouched, and editing a transfer in the copy moves both sides.
  assert.equal((await dad('GET', '/transactions?limit=100')).body.total, 6);
  const transfer = (await copy('GET', '/transactions?account=Visa')).body.transactions.find((t) => t.type === 'transfer');
  await copy('PATCH', `/transactions/${transfer.id}`, { amount: 175 });
  assert.equal((await copy('GET', '/accounts')).body.find((a) => a.name === 'Checking').balance, 1000 - 60 + 2000 - 175);

  // Bad files are refused whole, with a message that says what is wrong.
  const before = (await me('GET', '/budgets')).body.length;
  const refuse = async (change, pattern) => {
    const broken = structuredClone(file);
    change(broken);
    const res = await me('POST', '/budgets/import', broken);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_import');
    assert.match(res.body.message, pattern);
  };
  await refuse((f) => { f.format = 'something-else'; }, /not a Knab budget file/);
  await refuse((f) => { f.version = 99; }, /version 99/);
  await refuse((f) => { f.transactions[1].account = 'Nowhere'; }, /Transaction 2 refers to the account "Nowhere"/);
  await refuse((f) => { f.transactions[1].category = 'Nope'; }, /category "Nope"/);
  await refuse((f) => { f.transactions[0].date = '2026-02-30'; }, /Transaction 1: the date/);
  await refuse((f) => { f.accounts.push({ name: 'checking' }); }, /account "checking" appears more than once/);
  await refuse((f) => { f.transactions.find((t) => t.transfer_ref).amount = 1; }, /opposite amounts/);
  await refuse((f) => { f.transactions.find((t) => t.transfer_ref).transfer_ref = 999; }, /no matching other side/);
  await refuse((f) => { f.flags[0].color = 'beige'; }, /colour must be one of/);
  assert.equal((await me('GET', '/budgets')).body.length, before);

  // Importing needs a signed-in user; a token for one budget cannot create another.
  assert.equal((await anon('POST', '/budgets/import', file)).status, 401);
  const token = (await me('POST', '/tokens', { name: 't', budget_id: budgetId })).body.token;
  const viaToken = await app.inject({ method: 'POST', url: '/api/v1/budgets/import', payload: file, headers: { authorization: `Bearer ${token}` } });
  assert.equal(viaToken.statusCode, 403);
  assert.equal((await me('GET', '/budgets')).body.length, before);
});

test('flags: add, use, filter, rename and remove', async () => {
  const { dad } = await setup();
  await dad('POST', '/accounts', { name: 'Checking', opening_balance: 100 });
  const flags = (await dad('GET', '/flags')).body;
  assert.deepEqual(flags.map((f) => f.name), ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'To review']);
  assert.deepEqual(flags.filter((f) => f.review).map((f) => f.name), ['To review']);

  const extra = await dad('POST', '/flags', { name: 'Reimburse', color: 'teal' });
  assert.equal(extra.status, 201);
  assert.equal((await dad('POST', '/flags', { name: 'reimburse', color: 'red' })).status, 409);
  assert.equal((await dad('POST', '/flags', { name: 'X', color: 'beige' })).status, 400);

  const tx = await dad('POST', '/transactions', { amount: 5, type: 'expense', account: 'Checking', category: 'Groceries', flag: 'reimburse' });
  assert.deepEqual([tx.body.flag, tx.body.flag_color], ['Reimburse', 'teal']);
  const bad = await dad('POST', '/transactions', { amount: 5, type: 'expense', account: 'Checking', category: 'Groceries', flag: 'Nope' });
  assert.equal(bad.body.error, 'unknown_flag');
  assert.ok(bad.body.valid_flags.includes('Reimburse'));

  await dad('POST', '/transactions', { amount: 7, type: 'expense', account: 'Checking', category: 'Groceries' });
  assert.equal((await dad('GET', '/transactions?flag=Reimburse')).body.total, 1);
  assert.equal((await dad('GET', '/flags')).body.find((f) => f.name === 'Reimburse').count, 1);

  await dad('PATCH', `/flags/${extra.body.id}`, { name: 'Owed', color: 'pink' });
  assert.deepEqual((await dad('GET', '/transactions?flag=Owed')).body.transactions.map((t) => t.flag_color), ['pink']);
  assert.equal((await dad('PATCH', `/transactions/${tx.body.id}`, { memo: 'kept' })).body.flag, 'Owed');
  assert.equal((await dad('PATCH', `/transactions/${tx.body.id}`, { flag: '' })).body.flag, null);
  await dad('PATCH', `/transactions/${tx.body.id}`, { flag: 'Owed' });

  assert.equal((await dad('DELETE', `/flags/${extra.body.id}`)).status, 200);
  assert.equal((await dad('GET', `/transactions`)).body.transactions.find((t) => t.id === tx.body.id).flag, null);
  assert.equal((await dad('GET', '/flags')).body.length, 7);

  // A wrong category tells an agent what to do, naming the review flag.
  const guess = await dad('POST', '/transactions', { amount: 5, type: 'expense', account: 'Checking', category: 'Coffee' });
  assert.equal(guess.body.error, 'unknown_category');
  assert.equal(guess.body.review_flag, 'To review');
  assert.match(guess.body.hint, /closest in meaning, set "flag" to "To review"/);
  assert.equal((await dad('POST', '/transactions', { amount: 5, type: 'expense', account: 'Checking' })).body.review_flag, 'To review');
  // An unknown account gets no such hint: accounts are never guessed.
  assert.equal((await dad('POST', '/transactions', { amount: 5, type: 'expense', account: 'Nope', category: 'Groceries' })).body.hint, undefined);

  // The review mark moves to another flag, and only one flag has it.
  const red = (await dad('GET', '/flags')).body.find((f) => f.name === 'Red');
  assert.equal((await dad('PATCH', `/flags/${red.id}`, { review: true })).body.review, true);
  assert.deepEqual((await dad('GET', '/flags')).body.filter((f) => f.review).map((f) => f.name), ['Red']);
  assert.equal((await dad('POST', '/transactions', { amount: 5, type: 'expense', account: 'Checking', category: 'Coffee' })).body.review_flag, 'Red');
  // With no review flag the hint falls back to the memo alone.
  await dad('PATCH', `/flags/${red.id}`, { review: false });
  const none = await dad('POST', '/transactions', { amount: 5, type: 'expense', account: 'Checking', category: 'Coffee' });
  assert.equal(none.body.review_flag, undefined);
  assert.match(none.body.hint, /start "memo" with "To review:"/);
});

test('planned items: installments wait, are entered or skipped, and drive the forecast', async () => {
  const { dad } = await setup(); // cutoff day 23
  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const plus = (days) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
  await dad('POST', '/accounts', { name: 'Checking', opening_balance: 1000 });
  await dad('POST', '/accounts', { name: 'Visa', type: 'credit' });

  // A 12-payment installment with 3 left, first due yesterday, that waits for the user.
  const made = await dad('POST', '/recurring', {
    name: 'Laptop', date: plus(-1), amount: 650, type: 'expense', account: 'Visa', category: 'Household',
    frequency: 'monthly', auto: false, payments: 12, payments_left: 3, is_debt: true,
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.posted_now, 0); // overdue, but it waits
  const laptop = made.body.schedule;
  assert.deepEqual([laptop.kind, laptop.auto, laptop.payments, laptop.payments_left, laptop.left_to_pay, laptop.is_debt], ['installment', false, 12, 3, 1950, true]);
  assert.equal((await dad('GET', '/accounts')).body.find((a) => a.name === 'Visa').balance, 0);

  // An automatic bill dated yesterday enters itself; a one-off and salary are in the future.
  const rent = await dad('POST', '/recurring', { name: 'Rent', date: plus(-1), amount: 300, type: 'expense', account: 'Checking', category: 'Rent / Mortgage', frequency: 'monthly' });
  assert.equal(rent.body.posted_now, 1);
  assert.equal(rent.body.schedule.kind, 'ongoing');
  await dad('POST', '/recurring', { name: 'Insurance', date: plus(70), amount: 900, type: 'expense', account: 'Visa', category: 'Transport', frequency: 'monthly', auto: false, payments: 1 });
  await dad('POST', '/recurring', { name: 'Salary', date: plus(5), amount: 2000, type: 'income', account: 'Checking', frequency: 'monthly' });
  assert.equal((await dad('POST', '/recurring', { date: plus(5), amount: 1, type: 'income', account: 'Checking', frequency: 'monthly', payments: 2, payments_left: 5 })).body.error, 'invalid_payments');

  const fc = (await dad('GET', '/forecast?periods=6')).body;
  assert.equal(fc.periods.length, 6);
  assert.equal(fc.summary.committed_debt, 1950);
  assert.equal(fc.summary.debt_items, 1);
  assert.equal(fc.summary.due_now, 1);
  const all = fc.periods.flatMap((p) => p.occurrences);
  const laptops = all.filter((o) => o.name === 'Laptop');
  assert.deepEqual(laptops.map((o) => [o.number, o.of, o.actionable]), [[10, 12, true], [11, 12, false], [12, 12, false]]);
  assert.equal(laptops[0].overdue, true);
  assert.equal(fc.periods[0].occurrences[0].name, 'Laptop'); // overdue items show in the current period
  assert.equal(all.filter((o) => o.name === 'Insurance').length, 1);
  assert.equal(fc.periods.reduce((s, p) => s + p.installments, 0), 1950);
  assert.equal(fc.periods.reduce((s, p) => s + p.one_offs, 0), 900);
  assert.ok(fc.periods.reduce((s, p) => s + p.income, 0) >= 2000 * 5);
  assert.ok(fc.periods.every((p) => Math.abs(p.total - (p.installments + p.bills + p.one_offs)) < 0.001));
  assert.equal((await dad('GET', '/reports/trend?count=1')).body.committed_debt, 1950);

  // Assigned amounts appear beside the plan.
  await dad('PUT', '/budget/assign', { category: 'Household', period: fc.periods[1].label, amount: 500 });
  assert.equal((await dad('GET', '/forecast?periods=2')).body.periods[1].assigned, 500);

  // Entering the next payment, adjusted, creates the transaction and moves the item on.
  const entered = (await dad('POST', `/recurring/${laptop.id}/enter`, { amount: 655.5, memo: 'with fee', flag: 'Red' })).body;
  assert.deepEqual([entered.transaction.signed_amount, entered.transaction.account, entered.transaction.category, entered.transaction.payee, entered.transaction.memo, entered.transaction.flag],
    [-655.5, 'Visa', 'Household', 'Laptop', 'with fee', 'Red']);
  assert.equal(entered.transaction.date, plus(-1));
  assert.deepEqual([entered.schedule.payments_left, entered.schedule.left_to_pay], [2, 1300]);
  assert.equal((await dad('GET', '/accounts')).body.find((a) => a.name === 'Visa').balance, -655.5);
  assert.equal((await dad('POST', '/recurring/enter-due')).body.entered, 0); // nothing else is due

  // Fixing the count after the fact: it was really 4 left, not 2.
  const fixed = (await dad('PATCH', `/recurring/${laptop.id}`, { payments_left: 4 })).body.schedule;
  assert.deepEqual([fixed.payments, fixed.payments_left, fixed.left_to_pay], [12, 4, 2600]);
  // Skipping uses one up without a transaction; the last one removes the item.
  assert.equal((await dad('POST', `/recurring/${laptop.id}/skip`)).body.schedule.payments_left, 3);
  await dad('PATCH', `/recurring/${laptop.id}`, { payments_left: 1, date: plus(-2) });
  assert.equal((await dad('POST', '/recurring/enter-due')).body.entered, 1);
  assert.equal((await dad('GET', '/recurring')).body.some((r) => r.name === 'Laptop'), false);
  assert.equal((await dad('GET', '/forecast')).body.summary.committed_debt, 0);
  assert.equal((await dad('GET', '/transactions?account=Visa')).body.total, 2);

  // An ongoing item can be given an end, and an installment made open-ended again.
  const rentId = rent.body.schedule.id;
  assert.equal((await dad('PATCH', `/recurring/${rentId}`, { payments: 6 })).body.schedule.kind, 'installment');
  assert.equal((await dad('PATCH', `/recurring/${rentId}`, { payments: 0 })).body.schedule.kind, 'ongoing');
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
