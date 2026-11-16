// Planned items (recurring schedules, installments, one-offs) and the forecast
// built from them. The endpoints keep the /recurring name they have always had.
import { resolveBudget } from '../auth.js';
import { HttpError, toCents, fromCents, assertDate } from '../util.js';
import * as schemas from '../schemas.js';
import {
  txShape, getTransaction, findFlag, resolveEntry, advancePlanned, enterPlanned, postDueRecurring,
} from '../ledger.js';
import { todayStr, parseDate, nextOccurrence, periodFor, periodByLabel, shiftLabel } from '../../shared/periods.js';

const security = [{ bearerAuth: [] }];
const errors = { 400: schemas.errorResponse, 401: schemas.errorResponse };

const kindOf = (r) => (r.remaining === null ? 'ongoing' : r.total_count === 1 ? 'once' : 'installment');

// The dates an item will still occur on, up to `until`, oldest first.
// `number` counts from the first payment of the item ("6" of 12).
function* occurrences(r, until) {
  const made = r.remaining === null ? 0 : (r.total_count ?? r.remaining) - r.remaining;
  let date = r.next_date;
  for (let n = 0; n < 2000 && date <= until; n++) {
    if (r.remaining !== null && n >= r.remaining) return;
    if (r.end_date && date > r.end_date) return;
    yield { date, index: n, number: made + n + 1 };
    date = nextOccurrence(date, r.frequency, r.anchor_day);
  }
}

function lastDate(r) {
  if (r.remaining === null) return r.end_date ?? null;
  let date = r.next_date;
  for (let n = 1; n < r.remaining; n++) {
    const next = nextOccurrence(date, r.frequency, r.anchor_day);
    if (r.end_date && next > r.end_date) break;
    date = next;
  }
  return date;
}

export function plannedRoutes(app) {
  const db = app.db;
  const budgetOf = (request) => resolveBudget(app, request);

  const SELECT = `
    SELECT r.*, a.name AS account, c.name AS category FROM recurring r
    JOIN accounts a ON a.id = r.account_id LEFT JOIN categories c ON c.id = r.category_id`;

  const shape = (r) => {
    const income = r.amount > 0;
    return {
      id: r.id,
      name: r.name || r.payee || (income ? 'Income' : 'Expense'),
      next_date: r.next_date,
      amount: fromCents(Math.abs(r.amount)),
      type: income ? 'income' : 'expense',
      account: r.account,
      category: r.category ?? null,
      payee: r.payee,
      memo: r.memo,
      frequency: r.frequency,
      end_date: r.end_date ?? null,
      kind: kindOf(r),
      auto: Boolean(r.auto),
      is_debt: Boolean(r.is_debt),
      payments: r.total_count ?? null,
      payments_left: r.remaining ?? null,
      left_to_pay: r.remaining === null ? null : fromCents(r.remaining * Math.abs(r.amount)),
      last_date: lastDate(r),
    };
  };

  const getOne = (budgetId, id) => {
    const r = db.prepare(`${SELECT} WHERE r.id = ? AND r.budget_id = ?`).get(id, budgetId);
    if (!r) throw new HttpError(404, 'recurring_not_found', 'No such planned item.');
    return r;
  };
  const after = (id) => {
    const row = db.prepare(`${SELECT} WHERE r.id = ?`).get(id);
    return row ? shape(row) : null;
  };

  // payments / payments_left as sent -> the two stored counts. `current` is the
  // row being changed, or null when creating.
  function counts(body, current) {
    let total = current ? current.total_count : null;
    let left = current ? current.remaining : null;
    if (body.payments !== undefined) {
      if (body.payments === 0) return { total: null, left: null }; // open-ended
      // Changing the length keeps the number already paid.
      const made = total !== null && left !== null ? Math.max(0, total - left) : 0;
      total = body.payments;
      left = body.payments_left ?? Math.max(1, total - made);
    } else if (body.payments_left !== undefined) {
      left = body.payments_left;
      if (total === null || total < left) total = left;
    }
    if (left !== null && left > total) {
      throw new HttpError(400, 'invalid_payments', '"payments_left" cannot be more than "payments".');
    }
    return { total, left };
  }

  app.get('/recurring', {
    schema: { tags: ['Planned'], summary: 'List planned items: recurring transactions, installments and one-offs', security },
  }, async (request) => {
    const budget = budgetOf(request);
    return db.prepare(`${SELECT} WHERE r.budget_id = ? ORDER BY r.next_date, r.id`).all(budget.id).map(shape);
  });

  app.post('/recurring', {
    schema: {
      tags: ['Planned'], summary: 'Create a planned item', security, body: schemas.recurringCreate, response: errors,
      description: '"date" is the first occurrence. With "auto" true (the default) anything dated today or earlier is entered immediately; with "auto" false it waits in the forecast.',
    },
  }, async (request, reply) => {
    const budget = budgetOf(request);
    const body = request.body;
    const entry = resolveEntry(db, budget.id, body);
    const endDate = body.end_date ? assertDate(body.end_date, 'end_date') : null;
    const { total, left } = counts(body, null);
    const id = db.prepare(
      `INSERT INTO recurring (budget_id, account_id, category_id, amount, payee, memo, frequency, next_date, anchor_day, end_date,
                              name, auto, total_count, remaining, is_debt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      budget.id, entry.account_id, entry.category_id, entry.amount, entry.payee, entry.memo,
      body.frequency, entry.date, parseDate(entry.date).d, endDate,
      (body.name ?? '').trim(), body.auto === false ? 0 : 1, total, left, body.is_debt ? 1 : 0,
    ).lastInsertRowid;
    const posted = postDueRecurring(db, todayStr(), budget.id);
    reply.code(201);
    return { posted_now: posted, schedule: after(id) };
  });

  app.patch('/recurring/:id', {
    schema: { tags: ['Planned'], summary: 'Change a planned item', security, body: schemas.recurringUpdate, response: errors },
  }, async (request) => {
    const budget = budgetOf(request);
    const row = getOne(budget.id, request.params.id);
    const current = shape(row);
    const body = request.body;
    const entry = resolveEntry(db, budget.id, {
      date: body.date ?? current.next_date,
      amount: body.amount ?? current.amount,
      type: body.type ?? current.type,
      account: body.account ?? current.account,
      category: body.category ?? current.category ?? '',
      payee: body.payee ?? current.payee,
      memo: body.memo ?? current.memo,
    });
    const endDate = body.end_date === undefined ? current.end_date : body.end_date ? assertDate(body.end_date, 'end_date') : null;
    const { total, left } = counts(body, row);
    db.prepare(
      `UPDATE recurring SET account_id = ?, category_id = ?, amount = ?, payee = ?, memo = ?, frequency = ?,
         next_date = ?, anchor_day = CASE WHEN ? THEN ? ELSE anchor_day END, end_date = ?,
         name = ?, auto = ?, total_count = ?, remaining = ?, is_debt = ? WHERE id = ?`,
    ).run(
      entry.account_id, entry.category_id, entry.amount, entry.payee, entry.memo, body.frequency ?? current.frequency,
      entry.date, body.date ? 1 : 0, parseDate(entry.date).d, endDate,
      body.name !== undefined ? body.name.trim() : row.name, (body.auto ?? current.auto) ? 1 : 0, total, left,
      (body.is_debt ?? current.is_debt) ? 1 : 0, current.id,
    );
    postDueRecurring(db, todayStr(), budget.id);
    return { schedule: after(current.id) };
  });

  // Skips the next occurrence without entering it.
  app.post('/recurring/:id/skip', {
    schema: { tags: ['Planned'], summary: 'Skip the next occurrence', security },
  }, async (request) => {
    const budget = budgetOf(request);
    const next = advancePlanned(db, getOne(budget.id, request.params.id));
    return { schedule: next ? after(next.id) : null };
  });

  // Turns the next occurrence into a real transaction, optionally adjusted.
  app.post('/recurring/:id/enter', {
    schema: {
      tags: ['Planned'], summary: 'Enter the next occurrence as a transaction', security, response: errors,
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          amount: { type: 'number', exclusiveMinimum: 0, description: 'Amount for this one entry, if it differs from the plan.' },
          date: { type: 'string', description: 'Date for this one entry, YYYY-MM-DD. Defaults to the planned date.' },
          memo: { type: 'string', maxLength: 500 },
          cleared: { type: 'boolean' },
          flag: { type: 'string', description: 'Flag name for the transaction.' },
        },
      },
    },
  }, async (request) => {
    const budget = budgetOf(request);
    const r = getOne(budget.id, request.params.id);
    const body = request.body || {};
    const changes = { cleared: body.cleared };
    if (body.amount !== undefined) changes.amount = (r.amount < 0 ? -1 : 1) * toCents(body.amount);
    if (body.date !== undefined) changes.date = assertDate(body.date);
    if (body.memo !== undefined) changes.memo = body.memo.trim();
    if (body.flag && body.flag.trim()) changes.flag_id = findFlag(db, budget.id, body.flag).id;
    const result = db.transaction(() => enterPlanned(db, r, changes, request.user.id))();
    return { transaction: txShape(getTransaction(db, budget.id, result.id)), schedule: result.after ? after(r.id) : null };
  });

  // Enters everything that waits for the user and is due today or earlier.
  app.post('/recurring/enter-due', {
    schema: { tags: ['Planned'], summary: 'Enter every waiting occurrence that is due today or overdue', security },
  }, async (request) => {
    const budget = budgetOf(request);
    return { entered: postDueRecurring(db, todayStr(), budget.id, { manual: true, userId: request.user.id }) };
  });

  app.delete('/recurring/:id', {
    schema: { tags: ['Planned'], summary: 'Delete a planned item; transactions already entered stay', security },
  }, async (request) => {
    const budget = budgetOf(request);
    db.prepare('DELETE FROM recurring WHERE id = ?').run(getOne(budget.id, request.params.id).id);
    return { ok: true };
  });

  // ---- Forecast ----

  app.get('/forecast', {
    schema: {
      tags: ['Planned'], summary: 'Planned expenses and income for the coming periods', security,
      querystring: {
        type: 'object',
        properties: { periods: { type: 'integer', minimum: 1, maximum: 36, default: 12, description: 'How many periods, starting with the current one.' } },
      },
    },
  }, async (request) => {
    const budget = budgetOf(request);
    const today = todayStr();
    const first = periodFor(today, budget.cutoff_day);
    const periods = Array.from({ length: request.query.periods }, (_, i) => {
      const p = periodByLabel(shiftLabel(first.label, i), budget.cutoff_day);
      return { ...p, cents: { installment: 0, ongoing: 0, once: 0, income: 0 }, occurrences: [] };
    });
    const index = new Map(periods.map((p, i) => [p.label, i]));
    const until = periods[periods.length - 1].end;

    const rows = db.prepare(`${SELECT} WHERE r.budget_id = ? ORDER BY r.next_date, r.id`).all(budget.id);
    let committed = 0;
    for (const r of rows) {
      const kind = kindOf(r);
      const income = r.amount > 0;
      if (r.is_debt && !income && r.remaining !== null) committed += r.remaining * -r.amount;
      const name = r.name || r.payee || (income ? 'Income' : 'Expense');
      for (const o of occurrences(r, until)) {
        // Anything left over from an earlier period is shown, overdue, in the current one.
        const period = periods[o.date < first.start ? 0 : index.get(periodFor(o.date, budget.cutoff_day).label)];
        if (income) period.cents.income += r.amount;
        else period.cents[kind] -= r.amount;
        period.occurrences.push({
          item_id: r.id, name, date: o.date, amount: fromCents(Math.abs(r.amount)), type: income ? 'income' : 'expense', kind,
          account: r.account, category: r.category ?? null, auto: Boolean(r.auto),
          number: kind === 'installment' ? o.number : null, of: kind === 'installment' ? r.total_count : null,
          // Occurrences are entered in order, so only an item's next one can be acted on.
          actionable: o.index === 0, overdue: o.date < today, due_today: o.date === today,
        });
      }
    }

    const assigned = new Map(db.prepare(
      'SELECT period, SUM(amount) AS n FROM assignments WHERE budget_id = ? AND period BETWEEN ? AND ? GROUP BY period',
    ).all(budget.id, periods[0].label, periods[periods.length - 1].label).map((a) => [a.period, a.n]));

    const out = periods.map((p) => {
      const total = p.cents.installment + p.cents.ongoing + p.cents.once;
      return {
        label: p.label, start: p.start, end: p.end,
        installments: fromCents(p.cents.installment), bills: fromCents(p.cents.ongoing), one_offs: fromCents(p.cents.once),
        total: fromCents(total), income: fromCents(p.cents.income), assigned: fromCents(assigned.get(p.label) || 0),
        occurrences: p.occurrences.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.item_id - b.item_id)),
      };
    });

    // "Eases": after the heaviest period, the first one from which every period
    // in view stays clearly lighter (under 85% of that peak).
    const heaviest = out.reduce((best, p) => (p.total >= best.total ? p : best), out[0]);
    let eases = null;
    for (let i = out.length - 1; i > out.indexOf(heaviest) && out[i].total < heaviest.total * 0.85; i--) eases = i;
    const pick = ({ label, start, end, total }) => ({ label, start, end, total });
    const due = out[0].occurrences.filter((o) => o.type === 'expense');
    return {
      today,
      periods: out,
      items: rows.map(shape),
      summary: {
        this_period: { ...pick(out[0]), count: due.length },
        due_now: out[0].occurrences.filter((o) => !o.auto && (o.overdue || o.due_today)).length,
        heaviest: heaviest.total > 0 ? pick(heaviest) : null,
        committed_debt: fromCents(committed),
        debt_items: rows.filter((r) => r.is_debt && r.amount < 0 && r.remaining !== null).length,
        eases: eases !== null ? {
          ...pick(out[eases]),
          // Installments that finish before that period starts.
          finished: rows.filter((r) => kindOf(r) === 'installment' && r.amount < 0 && lastDate(r) < out[eases].start).map((r) => r.name || r.payee).filter(Boolean).slice(0, 3),
        } : null,
      },
    };
  });
}
