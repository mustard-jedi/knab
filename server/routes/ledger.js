// Accounts, categories, transactions, transfers, recurring schedules, export.
import { resolveBudget } from '../auth.js';
import { HttpError, toCents, fromCents, assertDate } from '../util.js';
import * as schemas from '../schemas.js';
import {
  TX_SELECT, txShape, findAccount, findCategory, findFlag, resolveEntry, insertTransaction,
  createTransaction, updateTransaction, deleteTransaction, createTransfer, postDueRecurring,
} from '../ledger.js';
import { todayStr, parseDate, nextOccurrence } from '../../shared/periods.js';
import { FLAG_COLORS } from '../../shared/flags.js';

const ACCOUNT_TYPES = ['checking', 'savings', 'cash', 'credit', 'other'];
const security = [{ bearerAuth: [] }];
const errors = { 400: schemas.errorResponse, 401: schemas.errorResponse };

export function ledgerRoutes(app) {
  const db = app.db;
  const budgetOf = (request, opts) => resolveBudget(app, request, opts);
  const conflict = (err, message) => {
    if (String(err.code).startsWith('SQLITE_CONSTRAINT')) throw new HttpError(409, 'name_taken', message);
    throw err;
  };

  // ---- Accounts ----

  app.get('/accounts', {
    schema: { tags: ['Lookups'], summary: 'List accounts with their balances', security },
  }, async (request) => {
    const budget = budgetOf(request);
    return db.prepare(
      `SELECT a.id, a.name, a.type, a.closed,
              COALESCE(SUM(t.amount), 0) AS balance,
              COALESCE(SUM(CASE WHEN t.cleared = 1 THEN t.amount END), 0) AS cleared_balance
       FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
       WHERE a.budget_id = ? GROUP BY a.id ORDER BY a.closed, a.name`,
    ).all(budget.id).map((a) => ({
      ...a, closed: Boolean(a.closed), balance: fromCents(a.balance), cleared_balance: fromCents(a.cleared_balance),
    }));
  });

  app.post('/accounts', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
          type: { type: 'string', enum: ACCOUNT_TYPES },
          opening_balance: { type: 'number' },
          opening_date: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const budget = budgetOf(request);
    const { name, type = 'checking', opening_balance = 0, opening_date } = request.body;
    const cents = toCents(opening_balance, 'opening_balance');
    const date = opening_date ? assertDate(opening_date, 'opening_date') : todayStr();
    let id;
    try {
      id = db.transaction(() => {
        const accountId = db.prepare('INSERT INTO accounts (budget_id, name, type) VALUES (?, ?, ?)')
          .run(budget.id, name.trim(), type).lastInsertRowid;
        if (cents !== 0) {
          insertTransaction(db, {
            budget_id: budget.id, account_id: accountId, date, amount: cents,
            payee: 'Opening balance', cleared: 1, opening: 1, created_by: request.user.id,
          });
        }
        return accountId;
      })();
    } catch (err) {
      conflict(err, `There is already an account named "${name}".`);
    }
    reply.code(201);
    return { id, name: name.trim(), type, closed: false, balance: fromCents(cents) };
  });

  app.patch('/accounts/:id', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
          type: { type: 'string', enum: ACCOUNT_TYPES },
          closed: { type: 'boolean' },
        },
      },
    },
  }, async (request) => {
    const budget = budgetOf(request);
    const a = db.prepare('SELECT * FROM accounts WHERE id = ? AND budget_id = ?').get(request.params.id, budget.id);
    if (!a) throw new HttpError(404, 'account_not_found', 'No such account.');
    const { name = a.name, type = a.type, closed = Boolean(a.closed) } = request.body;
    try {
      db.prepare('UPDATE accounts SET name = ?, type = ?, closed = ? WHERE id = ?').run(name.trim(), type, closed ? 1 : 0, a.id);
    } catch (err) {
      conflict(err, `There is already an account named "${name}".`);
    }
    return { ok: true };
  });

  // Only accounts with no activity can be deleted; otherwise close them, so
  // history and the other side of transfers stay intact.
  app.delete('/accounts/:id', async (request) => {
    const budget = budgetOf(request);
    const a = db.prepare('SELECT * FROM accounts WHERE id = ? AND budget_id = ?').get(request.params.id, budget.id);
    if (!a) throw new HttpError(404, 'account_not_found', 'No such account.');
    const used = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? AND opening = 0').get(a.id).n;
    if (used) throw new HttpError(409, 'account_in_use', 'This account has transactions. Close it instead of deleting it.');
    db.prepare('DELETE FROM accounts WHERE id = ?').run(a.id);
    return { ok: true };
  });

  // ---- Categories ----

  app.get('/categories', {
    schema: { tags: ['Lookups'], summary: 'List category groups and their categories', security },
  }, async (request) => {
    const budget = budgetOf(request);
    const groups = db.prepare('SELECT id, name FROM category_groups WHERE budget_id = ? ORDER BY sort, id').all(budget.id);
    const cats = db.prepare('SELECT id, group_id, name, hidden FROM categories WHERE budget_id = ? ORDER BY sort, id').all(budget.id);
    return groups.map((g) => ({
      ...g,
      categories: cats.filter((c) => c.group_id === g.id).map((c) => ({ id: c.id, name: c.name, hidden: Boolean(c.hidden) })),
    }));
  });

  const groupByName = (budgetId, name) => {
    const found = db.prepare('SELECT id FROM category_groups WHERE budget_id = ? AND name = ?').get(budgetId, name.trim());
    if (found) return found.id;
    const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM category_groups WHERE budget_id = ?').get(budgetId).s;
    return db.prepare('INSERT INTO category_groups (budget_id, name, sort) VALUES (?, ?, ?)').run(budgetId, name.trim(), sort).lastInsertRowid;
  };

  app.post('/category-groups', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['name'],
        properties: { name: { type: 'string', minLength: 1, maxLength: 80 } },
      },
    },
  }, async (request, reply) => {
    const budget = budgetOf(request);
    reply.code(201);
    return { id: groupByName(budget.id, request.body.name), name: request.body.name.trim() };
  });

  app.patch('/category-groups/:id', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['name'],
        properties: { name: { type: 'string', minLength: 1, maxLength: 80 } },
      },
    },
  }, async (request) => {
    const budget = budgetOf(request);
    try {
      db.prepare('UPDATE category_groups SET name = ? WHERE id = ? AND budget_id = ?').run(request.body.name.trim(), request.params.id, budget.id);
    } catch (err) {
      conflict(err, `There is already a group named "${request.body.name}".`);
    }
    return { ok: true };
  });

  app.delete('/category-groups/:id', async (request) => {
    const budget = budgetOf(request);
    const n = db.prepare('SELECT COUNT(*) AS n FROM categories WHERE group_id = ? AND budget_id = ?').get(request.params.id, budget.id).n;
    if (n) throw new HttpError(409, 'group_not_empty', 'Move or delete the categories in this group first.');
    db.prepare('DELETE FROM category_groups WHERE id = ? AND budget_id = ?').run(request.params.id, budget.id);
    return { ok: true };
  });

  const categoryBody = {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    group: { type: 'string', minLength: 1, maxLength: 80, description: 'Group name. Created if it does not exist.' },
    hidden: { type: 'boolean' },
  };

  app.post('/categories', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['name', 'group'], properties: categoryBody } },
  }, async (request, reply) => {
    const budget = budgetOf(request);
    const { name, group } = request.body;
    let id;
    try {
      id = db.transaction(() => {
        const groupId = groupByName(budget.id, group);
        const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM categories WHERE group_id = ?').get(groupId).s;
        return db.prepare('INSERT INTO categories (budget_id, group_id, name, sort) VALUES (?, ?, ?, ?)')
          .run(budget.id, groupId, name.trim(), sort).lastInsertRowid;
      })();
    } catch (err) {
      conflict(err, `There is already a category named "${name}".`);
    }
    reply.code(201);
    return { id, name: name.trim(), hidden: false };
  });

  app.patch('/categories/:id', {
    schema: { body: { type: 'object', additionalProperties: false, properties: categoryBody } },
  }, async (request) => {
    const budget = budgetOf(request);
    const c = db.prepare('SELECT * FROM categories WHERE id = ? AND budget_id = ?').get(request.params.id, budget.id);
    if (!c) throw new HttpError(404, 'category_not_found', 'No such category.');
    const { name = c.name, group, hidden = Boolean(c.hidden) } = request.body;
    try {
      db.transaction(() => {
        const groupId = group ? groupByName(budget.id, group) : c.group_id;
        db.prepare('UPDATE categories SET name = ?, group_id = ?, hidden = ? WHERE id = ?').run(name.trim(), groupId, hidden ? 1 : 0, c.id);
      })();
    } catch (err) {
      conflict(err, `There is already a category named "${name}".`);
    }
    return { ok: true };
  });

  app.delete('/categories/:id', async (request) => {
    const budget = budgetOf(request);
    const c = db.prepare('SELECT * FROM categories WHERE id = ? AND budget_id = ?').get(request.params.id, budget.id);
    if (!c) throw new HttpError(404, 'category_not_found', 'No such category.');
    const used = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE category_id = ?').get(c.id).n;
    if (used) throw new HttpError(409, 'category_in_use', 'This category has transactions. Hide it instead of deleting it.');
    db.prepare('DELETE FROM categories WHERE id = ?').run(c.id);
    return { ok: true };
  });

  app.get('/payees', async (request) => {
    const budget = budgetOf(request);
    return db.prepare(
      `SELECT payee FROM transactions WHERE budget_id = ? AND payee <> '' AND opening = 0
       GROUP BY payee ORDER BY MAX(id) DESC LIMIT 300`,
    ).all(budget.id).map((r) => r.payee);
  });

  // ---- Flags ----

  const flagBody = {
    name: { type: 'string', minLength: 1, maxLength: 40, description: 'Flag name, unique within the budget.' },
    color: { type: 'string', enum: Object.keys(FLAG_COLORS), description: 'Colour of the flag.' },
  };
  const flagOf = (budgetId, id) => {
    const row = db.prepare('SELECT id, name, color FROM flags WHERE id = ? AND budget_id = ?').get(id, budgetId);
    if (!row) throw new HttpError(404, 'flag_not_found', 'No such flag.');
    return row;
  };

  app.get('/flags', {
    schema: { tags: ['Flags'], summary: 'Flags of the budget, with how many transactions use each', security },
  }, async (request) => {
    const budget = budgetOf(request);
    return db.prepare(
      `SELECT f.id, f.name, f.color, (SELECT COUNT(*) FROM transactions t WHERE t.flag_id = f.id) AS count
       FROM flags f WHERE f.budget_id = ? ORDER BY f.sort, f.id`,
    ).all(budget.id);
  });

  app.post('/flags', {
    schema: {
      tags: ['Flags'], summary: 'Add a flag', security,
      body: { type: 'object', additionalProperties: false, required: ['name', 'color'], properties: flagBody },
    },
  }, async (request, reply) => {
    const budget = budgetOf(request);
    const name = request.body.name.trim();
    if (!name) throw new HttpError(400, 'invalid_name', '"name" must not be blank.');
    const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM flags WHERE budget_id = ?').get(budget.id).n;
    let id;
    try {
      id = db.prepare('INSERT INTO flags (budget_id, name, color, sort) VALUES (?, ?, ?, ?)').run(budget.id, name, request.body.color, sort).lastInsertRowid;
    } catch (err) { conflict(err, `There is already a flag named "${name}".`); }
    reply.code(201);
    return { id, name, color: request.body.color, count: 0 };
  });

  app.patch('/flags/:id', {
    schema: { tags: ['Flags'], summary: 'Rename or recolour a flag', security, body: { type: 'object', additionalProperties: false, properties: flagBody } },
  }, async (request) => {
    const budget = budgetOf(request);
    const current = flagOf(budget.id, request.params.id);
    const name = request.body.name !== undefined ? request.body.name.trim() : current.name;
    if (!name) throw new HttpError(400, 'invalid_name', '"name" must not be blank.');
    const color = request.body.color ?? current.color;
    try {
      db.prepare('UPDATE flags SET name = ?, color = ? WHERE id = ?').run(name, color, current.id);
    } catch (err) { conflict(err, `There is already a flag named "${name}".`); }
    return { id: current.id, name, color };
  });

  // Transactions that carried the flag simply lose it.
  app.delete('/flags/:id', {
    schema: { tags: ['Flags'], summary: 'Remove a flag; its transactions become unflagged', security },
  }, async (request) => {
    const budget = budgetOf(request);
    db.prepare('DELETE FROM flags WHERE id = ?').run(flagOf(budget.id, request.params.id).id);
    return { ok: true };
  });

  // ---- Transactions ----

  function txFilter(budget, query) {
    const where = ['t.budget_id = @budget'];
    const params = { budget: budget.id };
    if (query.account) { where.push('t.account_id = @account'); params.account = findAccount(db, budget.id, query.account).id; }
    if (query.category) { where.push('t.category_id = @category'); params.category = findCategory(db, budget.id, query.category).id; }
    if (query.flag) { where.push('t.flag_id = @flag'); params.flag = findFlag(db, budget.id, query.flag).id; }
    if (query.from) { where.push('t.date >= @from'); params.from = assertDate(query.from, 'from'); }
    if (query.to) { where.push('t.date <= @to'); params.to = assertDate(query.to, 'to'); }
    if (query.q) {
      where.push('(instr(lower(t.payee), lower(@q)) > 0 OR instr(lower(t.memo), lower(@q)) > 0 OR instr(lower(COALESCE(c.name, \'\')), lower(@q)) > 0)');
      params.q = query.q;
    }
    return { where: where.join(' AND '), params };
  }

  app.get('/transactions', {
    schema: {
      tags: ['Transactions'],
      summary: 'List transactions, newest first',
      security,
      querystring: {
        type: 'object',
        properties: {
          account: { type: 'string', description: 'Only this account (by name).' },
          category: { type: 'string', description: 'Only this category (by name).' },
          flag: { type: 'string', description: 'Only transactions with this flag (by name).' },
          from: { type: 'string', description: 'Earliest date, YYYY-MM-DD.' },
          to: { type: 'string', description: 'Latest date, YYYY-MM-DD.' },
          q: { type: 'string', description: 'Text to search for in payee, memo and category.' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request) => {
    const budget = budgetOf(request);
    const { where, params } = txFilter(budget, request.query);
    const { limit, offset } = request.query;
    const rows = db.prepare(`${TX_SELECT} WHERE ${where} ORDER BY t.date DESC, t.id DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit, offset });
    const summary = db.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(t.amount), 0) AS net
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE ${where}`,
    ).get(params);
    return { total: summary.total, net: fromCents(summary.net), transactions: rows.map(txShape) };
  });

  app.post('/transactions', {
    schema: {
      tags: ['Transactions'],
      summary: 'Create a transaction',
      description: 'Creates one expense or income transaction. Accounts and categories are referred to by name. On a mistake the response says exactly what to fix and lists the valid names.',
      security,
      body: schemas.transactionCreate,
      response: errors,
    },
  }, async (request, reply) => {
    const budget = budgetOf(request);
    reply.code(201);
    return createTransaction(db, budget.id, request.user.id, request.body);
  });

  app.patch('/transactions/:id', {
    schema: { tags: ['Transactions'], summary: 'Change a transaction', security, body: schemas.transactionUpdate, response: errors },
  }, async (request) => {
    const budget = budgetOf(request);
    return updateTransaction(db, budget.id, request.params.id, request.body);
  });

  app.delete('/transactions/:id', {
    schema: { tags: ['Transactions'], summary: 'Delete a transaction (both sides, if it is a transfer)', security },
  }, async (request) => {
    const budget = budgetOf(request);
    deleteTransaction(db, budget.id, request.params.id);
    return { ok: true };
  });

  app.post('/transfers', {
    schema: {
      tags: ['Transactions'], summary: 'Move money between two accounts', security,
      body: schemas.transferCreate, response: errors,
    },
  }, async (request, reply) => {
    const budget = budgetOf(request);
    reply.code(201);
    return createTransfer(db, budget.id, request.user.id, request.body);
  });

  app.get('/export/transactions.csv', async (request, reply) => {
    const budget = budgetOf(request);
    const rows = db.prepare(`${TX_SELECT} WHERE t.budget_id = ? ORDER BY t.date, t.id`).all(budget.id).map(txShape);
    const cell = (v) => {
      let s = String(v ?? '');
      // Stop spreadsheet apps from treating user text as a formula.
      if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ['date,account,payee,category,memo,amount,type,cleared,transfer_account,flag'];
    for (const t of rows) {
      lines.push([t.date, t.account, t.payee, t.category, t.memo, t.signed_amount.toFixed(2), t.type, t.cleared ? 'yes' : 'no', t.transfer_account, t.flag].map(cell).join(','));
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="transactions.csv"');
    return lines.join('\n') + '\n';
  });

  // ---- Recurring ----

  const RECURRING_SELECT = `
    SELECT r.*, a.name AS account, c.name AS category FROM recurring r
    JOIN accounts a ON a.id = r.account_id LEFT JOIN categories c ON c.id = r.category_id`;

  const recurringShape = (r) => ({
    id: r.id,
    next_date: r.next_date,
    amount: fromCents(Math.abs(r.amount)),
    type: r.amount < 0 ? 'expense' : 'income',
    account: r.account,
    category: r.category ?? null,
    payee: r.payee,
    memo: r.memo,
    frequency: r.frequency,
    end_date: r.end_date ?? null,
  });

  const getRecurring = (budgetId, id) => {
    const r = db.prepare(`${RECURRING_SELECT} WHERE r.id = ? AND r.budget_id = ?`).get(id, budgetId);
    if (!r) throw new HttpError(404, 'recurring_not_found', 'No such recurring transaction.');
    return r;
  };

  app.get('/recurring', {
    schema: { tags: ['Recurring'], summary: 'List recurring transactions', security },
  }, async (request) => {
    const budget = budgetOf(request);
    return db.prepare(`${RECURRING_SELECT} WHERE r.budget_id = ? ORDER BY r.next_date, r.id`).all(budget.id).map(recurringShape);
  });

  app.post('/recurring', {
    schema: { tags: ['Recurring'], summary: 'Create a recurring transaction', security, body: schemas.recurringCreate, response: errors },
  }, async (request, reply) => {
    const budget = budgetOf(request);
    const entry = resolveEntry(db, budget.id, request.body);
    const endDate = request.body.end_date ? assertDate(request.body.end_date, 'end_date') : null;
    const id = db.prepare(
      `INSERT INTO recurring (budget_id, account_id, category_id, amount, payee, memo, frequency, next_date, anchor_day, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      budget.id, entry.account_id, entry.category_id, entry.amount, entry.payee, entry.memo,
      request.body.frequency, entry.date, parseDate(entry.date).d, endDate,
    ).lastInsertRowid;
    const posted = postDueRecurring(db, todayStr(), budget.id);
    const row = db.prepare(`${RECURRING_SELECT} WHERE r.id = ?`).get(id);
    reply.code(201);
    return { posted_now: posted, schedule: row ? recurringShape(row) : null };
  });

  app.patch('/recurring/:id', {
    schema: { tags: ['Recurring'], summary: 'Change a recurring transaction', security, body: schemas.recurringUpdate, response: errors },
  }, async (request) => {
    const budget = budgetOf(request);
    const current = recurringShape(getRecurring(budget.id, request.params.id));
    const body = request.body;
    const merged = {
      date: body.date ?? current.next_date,
      amount: body.amount ?? current.amount,
      type: body.type ?? current.type,
      account: body.account ?? current.account,
      category: body.category ?? current.category ?? '',
      payee: body.payee ?? current.payee,
      memo: body.memo ?? current.memo,
    };
    const entry = resolveEntry(db, budget.id, merged);
    const endDate = body.end_date === undefined ? current.end_date : body.end_date ? assertDate(body.end_date, 'end_date') : null;
    db.prepare(
      `UPDATE recurring SET account_id = ?, category_id = ?, amount = ?, payee = ?, memo = ?, frequency = ?,
         next_date = ?, anchor_day = CASE WHEN ? THEN ? ELSE anchor_day END, end_date = ? WHERE id = ?`,
    ).run(
      entry.account_id, entry.category_id, entry.amount, entry.payee, entry.memo, body.frequency ?? current.frequency,
      entry.date, body.date ? 1 : 0, parseDate(entry.date).d, endDate, current.id,
    );
    postDueRecurring(db, todayStr(), budget.id);
    const row = db.prepare(`${RECURRING_SELECT} WHERE r.id = ?`).get(current.id);
    return { schedule: row ? recurringShape(row) : null };
  });

  // Skips the next occurrence without posting it.
  app.post('/recurring/:id/skip', {
    schema: { tags: ['Recurring'], summary: 'Skip the next occurrence', security },
  }, async (request) => {
    const budget = budgetOf(request);
    const r = getRecurring(budget.id, request.params.id);
    const next = nextOccurrence(r.next_date, r.frequency, r.anchor_day);
    if (r.end_date && next > r.end_date) {
      db.prepare('DELETE FROM recurring WHERE id = ?').run(r.id);
      return { schedule: null };
    }
    db.prepare('UPDATE recurring SET next_date = ? WHERE id = ?').run(next, r.id);
    return { schedule: recurringShape(getRecurring(budget.id, r.id)) };
  });

  app.delete('/recurring/:id', {
    schema: { tags: ['Recurring'], summary: 'Stop a recurring transaction', security },
  }, async (request) => {
    const budget = budgetOf(request);
    const r = getRecurring(budget.id, request.params.id);
    db.prepare('DELETE FROM recurring WHERE id = ?').run(r.id);
    return { ok: true };
  });
}
