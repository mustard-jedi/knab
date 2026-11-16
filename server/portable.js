// Whole-budget export and import as one JSON document.
//
// The file refers to accounts, categories and flags by name and carries no
// database ids, users, sharing or API tokens, so it can be loaded into any
// Knab server. Importing always creates a new budget; it never changes an
// existing one. Amounts are signed decimals: negative = money out.
import { HttpError, toCents, fromCents } from './util.js';
import { isValidDate } from '../shared/periods.js';
import { FLAG_COLORS } from '../shared/flags.js';

export const FORMAT = 'knab-budget';
export const VERSION = 1;

const ACCOUNT_TYPES = ['checking', 'savings', 'cash', 'credit', 'other'];
const FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'yearly'];

export function exportBudget(db, budget) {
  const all = (sql) => db.prepare(sql).all(budget.id);
  const groups = all('SELECT id, name FROM category_groups WHERE budget_id = ? ORDER BY sort, id');
  const categories = all('SELECT id, group_id, name, hidden FROM categories WHERE budget_id = ? ORDER BY sort, id');
  const transactions = all(
    `SELECT t.id, t.date, t.amount, t.payee, t.memo, t.cleared, t.opening, t.transfer_id,
            a.name AS account, c.name AS category, f.name AS flag
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN flags f ON f.id = t.flag_id
     WHERE t.budget_id = ? ORDER BY t.date, t.id`,
  );
  // `ref` numbers are local to the file; they only pair up the two sides of a transfer.
  const ref = new Map(transactions.map((t, i) => [t.id, i + 1]));
  return {
    format: FORMAT,
    version: VERSION,
    exported_at: new Date().toISOString(),
    budget: { name: budget.name, currency: budget.currency, cutoff_day: budget.cutoff_day },
    accounts: all('SELECT name, type, closed FROM accounts WHERE budget_id = ? ORDER BY id')
      .map((a) => ({ name: a.name, type: a.type, closed: Boolean(a.closed) })),
    groups: groups.map((g) => ({
      name: g.name,
      categories: categories.filter((c) => c.group_id === g.id).map((c) => ({ name: c.name, hidden: Boolean(c.hidden) })),
    })),
    flags: all('SELECT name, color, review FROM flags WHERE budget_id = ? ORDER BY sort, id')
      .map((f) => ({ name: f.name, color: f.color, review: Boolean(f.review) })),
    transactions: transactions.map((t) => ({
      ref: ref.get(t.id),
      date: t.date,
      amount: fromCents(t.amount),
      account: t.account,
      category: t.category ?? null,
      payee: t.payee,
      memo: t.memo,
      cleared: Boolean(t.cleared),
      opening_balance: Boolean(t.opening),
      flag: t.flag ?? null,
      transfer_ref: t.transfer_id ? ref.get(t.transfer_id) ?? null : null,
    })),
    assignments: all(
      `SELECT c.name AS category, s.period, s.amount FROM assignments s JOIN categories c ON c.id = s.category_id
       WHERE s.budget_id = ? ORDER BY s.period, c.name`,
    ).map((s) => ({ category: s.category, period: s.period, amount: fromCents(s.amount) })),
    recurring: all(
      `SELECT r.amount, r.payee, r.memo, r.frequency, r.next_date, r.anchor_day, r.end_date, r.name, r.auto, r.total_count, r.remaining, r.is_debt,
              a.name AS account, c.name AS category
       FROM recurring r JOIN accounts a ON a.id = r.account_id LEFT JOIN categories c ON c.id = r.category_id
       WHERE r.budget_id = ? ORDER BY r.id`,
    ).map((r) => ({
      account: r.account, category: r.category ?? null, amount: fromCents(r.amount), payee: r.payee, memo: r.memo,
      frequency: r.frequency, next_date: r.next_date, anchor_day: r.anchor_day, end_date: r.end_date ?? null,
      name: r.name, auto: Boolean(r.auto), payments: r.total_count ?? null, payments_left: r.remaining ?? null, is_debt: Boolean(r.is_debt),
    })),
  };
}

const bad = (message) => new HttpError(400, 'invalid_import', message);

// Validating helpers. `where` names the entry for the error message.
function text(value, where, { max = 500, required = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw bad(`${where} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw bad(`${where} must not be empty.`);
  if (trimmed.length > max) throw bad(`${where} is longer than ${max} characters.`);
  return trimmed;
}
const list = (value, name) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw bad(`"${name}" must be a list.`);
  return value;
};
const day = (value, where) => {
  if (!isValidDate(value)) throw bad(`${where} must be a date in YYYY-MM-DD format.`);
  return value;
};
// A payment count: a whole number from 1 to 600, or nothing (no end).
const count = (value, where) => {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > 600) throw bad(`${where} must be a whole number from 1 to 600.`);
  return value;
};
const money = (value, where) => {
  if (typeof value !== 'number') throw bad(`${where} must be a number.`);
  try { return toCents(value); } catch { throw bad(`${where} must be a number with at most 2 decimal places.`); }
};

// Creates a new budget owned by `userId` from an exported document and returns
// its id. Everything happens in one database transaction: a file that fails
// any check leaves nothing behind.
export function importBudget(db, userId, data) {
  if (!data || typeof data !== 'object' || data.format !== FORMAT) {
    throw bad(`This is not a Knab budget file (expected "format": "${FORMAT}").`);
  }
  if (data.version !== VERSION) {
    throw bad(`This file is version ${data.version}; this server reads version ${VERSION}. Update Knab and try again.`);
  }
  const info = data.budget && typeof data.budget === 'object' ? data.budget : {};
  let name = text(info.name, 'The budget name', { max: 80, required: true });
  const currency = text(info.currency || 'USD', 'The currency', { max: 3 }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw bad('The currency must be a 3-letter code.');
  const cutoff = info.cutoff_day ?? 1;
  if (!Number.isInteger(cutoff) || cutoff < 1 || cutoff > 31) throw bad('The period start day must be a whole number from 1 to 31.');

  // Keep it apart from a budget the user already has under the same name.
  const taken = new Set(db.prepare('SELECT name FROM budgets WHERE owner_id = ?').all(userId).map((b) => b.name.toLowerCase()));
  if (taken.has(name.toLowerCase())) {
    const base = `${name.slice(0, 68)} (imported`;
    let n = 1;
    do { name = `${base}${n > 1 ? ` ${n}` : ''})`; n += 1; } while (taken.has(name.toLowerCase()));
  }

  const key = (s) => s.toLowerCase();
  const unique = (map, label, value) => {
    if (map.has(key(value))) throw bad(`The ${label} "${value}" appears more than once.`);
  };
  const find = (map, label, value, where) => {
    if (value === null || value === undefined || value === '') return null;
    const id = typeof value === 'string' ? map.get(key(value.trim())) : undefined;
    if (!id) throw bad(`${where} refers to the ${label} "${value}", which is not in the file.`);
    return id;
  };

  return db.transaction(() => {
    const budgetId = db.prepare('INSERT INTO budgets (owner_id, name, currency, cutoff_day) VALUES (?, ?, ?, ?)')
      .run(userId, name, currency, cutoff).lastInsertRowid;

    const accounts = new Map();
    const addAccount = db.prepare('INSERT INTO accounts (budget_id, name, type, closed) VALUES (?, ?, ?, ?)');
    list(data.accounts, 'accounts').forEach((a, i) => {
      const n = text(a?.name, `Account ${i + 1}: the name`, { max: 80, required: true });
      unique(accounts, 'account', n);
      const type = a.type ?? 'checking';
      if (!ACCOUNT_TYPES.includes(type)) throw bad(`Account "${n}": the type must be one of ${ACCOUNT_TYPES.join(', ')}.`);
      accounts.set(key(n), addAccount.run(budgetId, n, type, a.closed ? 1 : 0).lastInsertRowid);
    });

    const groups = new Map();
    const categories = new Map();
    const addGroup = db.prepare('INSERT INTO category_groups (budget_id, name, sort) VALUES (?, ?, ?)');
    const addCategory = db.prepare('INSERT INTO categories (budget_id, group_id, name, sort, hidden) VALUES (?, ?, ?, ?, ?)');
    list(data.groups, 'groups').forEach((g, gi) => {
      const gn = text(g?.name, `Category group ${gi + 1}: the name`, { max: 80, required: true });
      unique(groups, 'category group', gn);
      const groupId = addGroup.run(budgetId, gn, gi).lastInsertRowid;
      groups.set(key(gn), groupId);
      list(g.categories, `categories of group "${gn}"`).forEach((c, ci) => {
        const cn = text(c?.name, `Group "${gn}", category ${ci + 1}: the name`, { max: 80, required: true });
        unique(categories, 'category', cn);
        categories.set(key(cn), addCategory.run(budgetId, groupId, cn, ci, c.hidden ? 1 : 0).lastInsertRowid);
      });
    });

    const flags = new Map();
    const addFlag = db.prepare('INSERT INTO flags (budget_id, name, color, sort, review) VALUES (?, ?, ?, ?, ?)');
    let hasReview = false;
    list(data.flags, 'flags').forEach((f, i) => {
      const n = text(f?.name, `Flag ${i + 1}: the name`, { max: 40, required: true });
      unique(flags, 'flag', n);
      if (!Object.hasOwn(FLAG_COLORS, f.color)) throw bad(`Flag "${n}": the colour must be one of ${Object.keys(FLAG_COLORS).join(', ')}.`);
      const review = Boolean(f.review) && !hasReview; // at most one
      hasReview ||= review;
      flags.set(key(n), addFlag.run(budgetId, n, f.color, i, review ? 1 : 0).lastInsertRowid);
    });

    const addTx = db.prepare(
      `INSERT INTO transactions (budget_id, account_id, date, amount, payee, category_id, memo, cleared, opening, flag_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const byRef = new Map(); // file ref -> { id, amount, partner }
    list(data.transactions, 'transactions').forEach((t, i) => {
      const where = `Transaction ${i + 1}`;
      if (!t || typeof t !== 'object') throw bad(`${where} is not an object.`);
      const accountId = find(accounts, 'account', t.account, where);
      if (!accountId) throw bad(`${where} has no account.`);
      const cents = money(t.amount, `${where}: the amount`);
      const isTransfer = t.transfer_ref !== null && t.transfer_ref !== undefined;
      const id = addTx.run(
        budgetId, accountId, day(t.date, `${where}: the date`), cents, text(t.payee, `${where}: the payee`, { max: 200 }),
        isTransfer ? null : find(categories, 'category', t.category, where), text(t.memo, `${where}: the memo`), t.cleared ? 1 : 0,
        t.opening_balance ? 1 : 0, find(flags, 'flag', t.flag, where), userId,
      ).lastInsertRowid;
      if (isTransfer) {
        if (t.ref === undefined || t.ref === null) throw bad(`${where} is a transfer but has no "ref".`);
        if (byRef.has(t.ref)) throw bad(`The transfer ref ${t.ref} appears more than once.`);
        byRef.set(t.ref, { id, amount: cents, partner: t.transfer_ref, accountId });
      }
    });
    // Link the two sides of each transfer, and insist that they really are a pair.
    const link = db.prepare('UPDATE transactions SET transfer_id = ? WHERE id = ?');
    for (const [ref, side] of byRef) {
      const other = byRef.get(side.partner);
      if (!other || other.partner !== ref || other === side) throw bad(`The transfer with ref ${ref} has no matching other side.`);
      if (other.amount !== -side.amount) throw bad(`The two sides of the transfer with ref ${ref} do not have opposite amounts.`);
      if (other.accountId === side.accountId) throw bad(`The transfer with ref ${ref} has the same account on both sides.`);
      link.run(other.id, side.id);
    }

    const addAssignment = db.prepare('INSERT INTO assignments (budget_id, category_id, period, amount) VALUES (?, ?, ?, ?)');
    const assigned = new Set();
    list(data.assignments, 'assignments').forEach((s, i) => {
      const where = `Assignment ${i + 1}`;
      const categoryId = find(categories, 'category', s?.category, where);
      if (!categoryId) throw bad(`${where} has no category.`);
      if (typeof s.period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(s.period)) throw bad(`${where}: the period must be in YYYY-MM format.`);
      if (assigned.has(`${categoryId}|${s.period}`)) throw bad(`${where} repeats the category "${s.category}" for ${s.period}.`);
      assigned.add(`${categoryId}|${s.period}`);
      const cents = money(s.amount, `${where}: the amount`);
      if (cents !== 0) addAssignment.run(budgetId, categoryId, s.period, cents);
    });

    const addRecurring = db.prepare(
      `INSERT INTO recurring (budget_id, account_id, category_id, amount, payee, memo, frequency, next_date, anchor_day, end_date,
                              name, auto, total_count, remaining, is_debt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    list(data.recurring, 'recurring').forEach((r, i) => {
      const where = `Recurring transaction ${i + 1}`;
      const accountId = find(accounts, 'account', r?.account, where);
      if (!accountId) throw bad(`${where} has no account.`);
      if (!FREQUENCIES.includes(r.frequency)) throw bad(`${where}: the frequency must be one of ${FREQUENCIES.join(', ')}.`);
      const next = day(r.next_date, `${where}: the next date`);
      const anchor = r.anchor_day ?? Number(next.slice(8, 10));
      if (!Number.isInteger(anchor) || anchor < 1 || anchor > 31) throw bad(`${where}: the anchor day must be from 1 to 31.`);
      addRecurring.run(
        budgetId, accountId, find(categories, 'category', r.category, where), money(r.amount, `${where}: the amount`),
        text(r.payee, `${where}: the payee`, { max: 200 }), text(r.memo, `${where}: the memo`), r.frequency, next, anchor,
        r.end_date ? day(r.end_date, `${where}: the end date`) : null,
        text(r.name, `${where}: the name`, { max: 80 }), r.auto === false ? 0 : 1, count(r.payments, `${where}: payments`),
        count(r.payments_left ?? r.payments, `${where}: payments left`), r.is_debt ? 1 : 0,
      );
    });

    return budgetId;
  })();
}
