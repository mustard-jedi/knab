// Core ledger operations shared by the HTTP routes and the recurring job.
import { HttpError, toCents, fromCents, assertDate } from './util.js';
import { todayStr, nextOccurrence } from '../shared/periods.js';

export function findAccount(db, budgetId, name, field = 'account') {
  const row = db.prepare('SELECT * FROM accounts WHERE budget_id = ? AND name = ?').get(budgetId, String(name).trim());
  if (row) return row;
  const valid = db.prepare('SELECT name FROM accounts WHERE budget_id = ? AND closed = 0 ORDER BY name').all(budgetId).map((r) => r.name);
  throw new HttpError(
    400,
    'unknown_account',
    `There is no account named "${name}". Valid accounts: ${valid.join(', ') || '(none yet)'}.`,
    { field, valid_accounts: valid },
  );
}

export function validCategories(db, budgetId) {
  return db.prepare('SELECT name FROM categories WHERE budget_id = ? AND hidden = 0 ORDER BY name').all(budgetId).map((r) => r.name);
}

export function findCategory(db, budgetId, name) {
  const row = db.prepare('SELECT * FROM categories WHERE budget_id = ? AND name = ?').get(budgetId, String(name).trim());
  if (row) return row;
  const valid = validCategories(db, budgetId);
  throw new HttpError(
    400,
    'unknown_category',
    `There is no category named "${name}". Valid categories: ${valid.join(', ') || '(none yet)'}.`,
    { field: 'category', valid_categories: valid },
  );
}

function categoryRequired(db, budgetId) {
  const valid = validCategories(db, budgetId);
  return new HttpError(
    400,
    'category_required',
    `An expense needs a "category". Valid categories: ${valid.join(', ') || '(none yet)'}.`,
    { field: 'category', valid_categories: valid },
  );
}

const TX_SELECT = `
  SELECT t.id, t.date, t.amount, t.payee, t.memo, t.cleared, t.opening, t.transfer_id, t.recurring_id,
         a.name AS account, c.name AS category, ta.name AS transfer_account
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN transactions tt ON tt.id = t.transfer_id
  LEFT JOIN accounts ta ON ta.id = tt.account_id`;

export { TX_SELECT };

export function txShape(row) {
  return {
    id: row.id,
    date: row.date,
    amount: fromCents(Math.abs(row.amount)),
    type: row.transfer_id ? 'transfer' : row.amount < 0 ? 'expense' : 'income',
    // Signed convenience value: negative = money left the account.
    signed_amount: fromCents(row.amount),
    account: row.account,
    category: row.category ?? null,
    payee: row.payee,
    memo: row.memo,
    cleared: Boolean(row.cleared),
    transfer_account: row.transfer_account ?? null,
    opening_balance: Boolean(row.opening),
    recurring_id: row.recurring_id ?? null,
  };
}

export function getTransaction(db, budgetId, id) {
  const row = db.prepare(`${TX_SELECT} WHERE t.id = ? AND t.budget_id = ?`).get(id, budgetId);
  if (!row) throw new HttpError(404, 'transaction_not_found', `There is no transaction with id ${id}.`);
  return row;
}

// Validates a flat {date, amount, type, account, category, ...} payload and
// resolves names to rows. Used for both transactions and recurring schedules.
export function resolveEntry(db, budgetId, body) {
  const date = body.date ? assertDate(body.date) : todayStr();
  const cents = toCents(body.amount);
  const account = findAccount(db, budgetId, body.account);
  let category = null;
  if (body.category && body.category.trim()) category = findCategory(db, budgetId, body.category);
  else if (body.type === 'expense') throw categoryRequired(db, budgetId);
  return {
    date,
    amount: body.type === 'expense' ? -cents : cents,
    account_id: account.id,
    category_id: category ? category.id : null,
    payee: (body.payee ?? '').trim(),
    memo: (body.memo ?? '').trim(),
    cleared: body.cleared ? 1 : 0,
  };
}

const INSERT_TX = `
  INSERT INTO transactions (budget_id, account_id, date, amount, payee, category_id, memo, cleared, opening, recurring_id, created_by)
  VALUES (@budget_id, @account_id, @date, @amount, @payee, @category_id, @memo, @cleared, @opening, @recurring_id, @created_by)`;

export function insertTransaction(db, row) {
  return db.prepare(INSERT_TX).run({
    payee: '', memo: '', category_id: null, cleared: 0, opening: 0, recurring_id: null, created_by: null, ...row,
  }).lastInsertRowid;
}

export function createTransaction(db, budgetId, userId, body) {
  const entry = resolveEntry(db, budgetId, body);
  const id = insertTransaction(db, { ...entry, budget_id: budgetId, created_by: userId });
  return txShape(getTransaction(db, budgetId, id));
}

export function updateTransaction(db, budgetId, id, body) {
  const current = db.prepare('SELECT * FROM transactions WHERE id = ? AND budget_id = ?').get(id, budgetId);
  if (!current) throw new HttpError(404, 'transaction_not_found', `There is no transaction with id ${id}.`);
  const date = body.date !== undefined ? assertDate(body.date) : current.date;
  const memo = body.memo !== undefined ? body.memo.trim() : current.memo;
  const cleared = body.cleared !== undefined ? (body.cleared ? 1 : 0) : current.cleared;
  const cents = body.amount !== undefined ? toCents(body.amount) : Math.abs(current.amount);

  if (current.transfer_id) {
    for (const field of ['type', 'account', 'category', 'payee']) {
      if (body[field] !== undefined) {
        throw new HttpError(400, 'transfer_field', `"${field}" cannot be changed on a transfer. Delete the transfer and create a new one.`);
      }
    }
    db.transaction(() => {
      db.prepare('UPDATE transactions SET date = ?, memo = ?, amount = ?, cleared = ? WHERE id = ?')
        .run(date, memo, current.amount < 0 ? -cents : cents, cleared, current.id);
      db.prepare('UPDATE transactions SET date = ?, memo = ?, amount = ? WHERE id = ?')
        .run(date, memo, current.amount < 0 ? cents : -cents, current.transfer_id);
    })();
    return txShape(getTransaction(db, budgetId, id));
  }

  const type = body.type ?? (current.amount < 0 ? 'expense' : 'income');
  const accountId = body.account !== undefined ? findAccount(db, budgetId, body.account).id : current.account_id;
  let categoryId = current.category_id;
  if (body.category !== undefined) {
    categoryId = body.category.trim() ? findCategory(db, budgetId, body.category).id : null;
  }
  // Opening balances may stay uncategorised; everything else follows the create rule.
  if ((body.type !== undefined || body.category !== undefined) && type === 'expense' && !categoryId && !current.opening) {
    throw categoryRequired(db, budgetId);
  }
  db.prepare(
    'UPDATE transactions SET date = ?, amount = ?, account_id = ?, category_id = ?, payee = ?, memo = ?, cleared = ? WHERE id = ?',
  ).run(
    date, type === 'expense' ? -cents : cents, accountId, categoryId,
    body.payee !== undefined ? body.payee.trim() : current.payee, memo, cleared, current.id,
  );
  return txShape(getTransaction(db, budgetId, id));
}

export function deleteTransaction(db, budgetId, id) {
  const current = db.prepare('SELECT id, transfer_id FROM transactions WHERE id = ? AND budget_id = ?').get(id, budgetId);
  if (!current) throw new HttpError(404, 'transaction_not_found', `There is no transaction with id ${id}.`);
  db.prepare('DELETE FROM transactions WHERE id IN (?, ?)').run(current.id, current.transfer_id ?? current.id);
}

export function createTransfer(db, budgetId, userId, body) {
  const date = body.date ? assertDate(body.date) : todayStr();
  const cents = toCents(body.amount);
  const from = findAccount(db, budgetId, body.from_account, 'from_account');
  const to = findAccount(db, budgetId, body.to_account, 'to_account');
  if (from.id === to.id) throw new HttpError(400, 'same_account', '"from_account" and "to_account" must be different accounts.');
  const memo = (body.memo ?? '').trim();
  const outId = db.transaction(() => {
    const base = { budget_id: budgetId, date, memo, created_by: userId, payee: '' };
    const a = insertTransaction(db, { ...base, account_id: from.id, amount: -cents });
    const b = insertTransaction(db, { ...base, account_id: to.id, amount: cents });
    db.prepare('UPDATE transactions SET transfer_id = ? WHERE id = ?').run(b, a);
    db.prepare('UPDATE transactions SET transfer_id = ? WHERE id = ?').run(a, b);
    return a;
  })();
  return txShape(getTransaction(db, budgetId, outId));
}

// ---- Recurring schedules ----

// Posts every schedule occurrence that is due on or before `today`, then moves
// each schedule forward. Safe to run as often as you like.
export function postDueRecurring(db, today = todayStr(), budgetId = null) {
  const due = db.prepare('SELECT * FROM recurring WHERE next_date <= ? AND (? IS NULL OR budget_id = ?)').all(today, budgetId, budgetId);
  let posted = 0;
  const run = db.transaction((r) => {
    let next = r.next_date;
    for (let guard = 0; next <= today && guard < 1000; guard++) {
      if (r.end_date && next > r.end_date) break;
      insertTransaction(db, {
        budget_id: r.budget_id, account_id: r.account_id, category_id: r.category_id, date: next,
        amount: r.amount, payee: r.payee, memo: r.memo, recurring_id: r.id,
      });
      posted++;
      next = nextOccurrence(next, r.frequency, r.anchor_day);
    }
    if (r.end_date && next > r.end_date) db.prepare('DELETE FROM recurring WHERE id = ?').run(r.id);
    else db.prepare('UPDATE recurring SET next_date = ? WHERE id = ?').run(next, r.id);
  });
  for (const r of due) run(r);
  return posted;
}
