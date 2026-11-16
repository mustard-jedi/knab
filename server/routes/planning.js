// The envelope budget view, assigning money, and reports.
//
// Nothing here is stored pre-computed. For a period P ending on date E:
//   available(category) = all money ever assigned up to P + all its transactions up to E
//   ready_to_assign     = all uncategorised, non-transfer money up to E - everything assigned up to P
// so Ready to Assign + the sum of every Available always equals the total of
// all account balances on E.
import { resolveBudget } from '../auth.js';
import { HttpError, toCents, fromCents, assertDate, assertLabel } from '../util.js';
import { findAccount, findCategory } from '../ledger.js';
import { todayStr, periodFor, periodByLabel, shiftLabel } from '../../shared/periods.js';

const security = [{ bearerAuth: [] }];

export function planningRoutes(app) {
  const db = app.db;

  app.get('/budget', {
    schema: {
      tags: ['Budget'],
      summary: 'Budget for one period: assigned, activity and available per category',
      security,
      querystring: {
        type: 'object',
        properties: { period: { type: 'string', description: 'Period label YYYY-MM. Defaults to the period containing today.' } },
      },
    },
  }, async (request) => {
    const budget = resolveBudget(app, request);
    const current = periodFor(todayStr(), budget.cutoff_day);
    const period = request.query.period ? periodByLabel(assertLabel(request.query.period), budget.cutoff_day) : current;

    const previous = periodByLabel(shiftLabel(period.label, -1), budget.cutoff_day);
    const rows = db.prepare(
      `SELECT c.id, c.name, c.hidden, c.group_id,
         COALESCE((SELECT amount FROM assignments s WHERE s.category_id = c.id AND s.period = @label), 0) AS assigned,
         COALESCE((SELECT SUM(amount) FROM assignments s WHERE s.category_id = c.id AND s.period <= @label), 0) AS assigned_total,
         COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.category_id = c.id AND t.date BETWEEN @start AND @end), 0) AS activity,
         COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.category_id = c.id AND t.date <= @end), 0) AS activity_total,
         COALESCE((SELECT amount FROM assignments s WHERE s.category_id = c.id AND s.period = @prevLabel), 0) AS last_assigned,
         COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.category_id = c.id AND t.date BETWEEN @prevStart AND @prevEnd), 0) AS last_activity
       FROM categories c WHERE c.budget_id = @budget ORDER BY c.sort, c.id`,
    ).all({
      budget: budget.id, label: period.label, start: period.start, end: period.end,
      prevLabel: previous.label, prevStart: previous.start, prevEnd: previous.end,
    });
    const future = db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM assignments WHERE budget_id = ? AND period > ?')
      .get(budget.id, period.label).n;

    const inflow = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS n FROM transactions
       WHERE budget_id = ? AND category_id IS NULL AND transfer_id IS NULL AND date <= ?`,
    ).get(budget.id, period.end).n;

    const groups = db.prepare('SELECT id, name FROM category_groups WHERE budget_id = ? ORDER BY sort, id').all(budget.id);
    const totals = { assigned: 0, activity: 0, available: 0 };
    let assignedEver = 0;
    const byGroup = new Map(groups.map((g) => [g.id, []]));
    for (const r of rows) {
      const available = r.assigned_total + r.activity_total;
      assignedEver += r.assigned_total;
      totals.assigned += r.assigned;
      totals.activity += r.activity;
      totals.available += available;
      byGroup.get(r.group_id).push({
        id: r.id, name: r.name, hidden: Boolean(r.hidden),
        assigned: fromCents(r.assigned), activity: fromCents(r.activity), available: fromCents(available),
        last_assigned: fromCents(r.last_assigned), last_activity: fromCents(r.last_activity),
      });
    }

    return {
      period,
      current_period: current.label,
      cutoff_day: budget.cutoff_day,
      currency: budget.currency,
      ready_to_assign: fromCents(inflow - assignedEver),
      totals: { assigned: fromCents(totals.assigned), activity: fromCents(totals.activity), available: fromCents(totals.available) },
      // What the categories held when the previous period ended.
      left_over: fromCents(totals.available - totals.assigned - totals.activity),
      assigned_future: fromCents(future),
      groups: groups.map((g) => ({ ...g, categories: byGroup.get(g.id) })),
    };
  });

  app.put('/budget/assign', {
    schema: {
      tags: ['Budget'],
      summary: 'Set the amount assigned to a category for a period',
      security,
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'amount'],
        properties: {
          category: { type: 'string', minLength: 1, description: 'Category name.' },
          period: { type: 'string', description: 'Period label YYYY-MM. Defaults to the period containing today.' },
          amount: { type: 'number', description: 'Total assigned for the period (replaces the previous value).' },
        },
      },
    },
  }, async (request) => {
    const budget = resolveBudget(app, request);
    const { category, amount } = request.body;
    const label = request.body.period ? assertLabel(request.body.period) : periodFor(todayStr(), budget.cutoff_day).label;
    const cat = findCategory(db, budget.id, category);
    const cents = toCents(amount);
    if (cents === 0) db.prepare('DELETE FROM assignments WHERE category_id = ? AND period = ?').run(cat.id, label);
    else {
      db.prepare(
        `INSERT INTO assignments (budget_id, category_id, period, amount) VALUES (?, ?, ?, ?)
         ON CONFLICT (category_id, period) DO UPDATE SET amount = excluded.amount`,
      ).run(budget.id, cat.id, label, cents);
    }
    return { category: cat.name, period: label, assigned: fromCents(cents) };
  });

  // ---- Reports ----

  app.get('/reports/spending', {
    schema: {
      tags: ['Reports'],
      summary: 'Spending by category for a date range',
      security,
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD. Defaults to the start of the current period.' },
          to: { type: 'string', description: 'YYYY-MM-DD. Defaults to the end of the current period.' },
          account: { type: 'string', description: 'Only this account (by name).' },
        },
      },
    },
  }, async (request) => {
    const budget = resolveBudget(app, request);
    const current = periodFor(todayStr(), budget.cutoff_day);
    const from = request.query.from ? assertDate(request.query.from, 'from') : current.start;
    const to = request.query.to ? assertDate(request.query.to, 'to') : current.end;
    const accountId = request.query.account ? findAccount(db, budget.id, request.query.account).id : null;
    const rows = db.prepare(
      `SELECT c.name AS category, g.name AS grp, -SUM(t.amount) AS spent
       FROM transactions t JOIN categories c ON c.id = t.category_id JOIN category_groups g ON g.id = c.group_id
       WHERE t.budget_id = @budget AND t.date BETWEEN @from AND @to AND (@account IS NULL OR t.account_id = @account)
       GROUP BY c.id HAVING SUM(t.amount) <> 0 ORDER BY spent DESC`,
    ).all({ budget: budget.id, from, to, account: accountId });
    return {
      from, to,
      total: fromCents(rows.reduce((sum, r) => sum + r.spent, 0)),
      categories: rows.map((r) => ({ category: r.category, group: r.grp, spent: fromCents(r.spent) })),
    };
  });

  // Income, spending and net worth for the last `count` periods.
  app.get('/reports/trend', {
    schema: {
      tags: ['Reports'],
      summary: 'Income, spending and net worth per period',
      security,
      querystring: {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 1, maximum: 36, default: 12 },
          end: { type: 'string', description: 'Label (YYYY-MM) of the last period. Defaults to the current period.' },
        },
      },
    },
  }, async (request) => {
    const budget = resolveBudget(app, request);
    const endLabel = request.query.end ? assertLabel(request.query.end) : periodFor(todayStr(), budget.cutoff_day).label;
    const flow = db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN category_id IS NULL AND transfer_id IS NULL AND opening = 0 THEN amount END), 0) AS income,
         COALESCE(-SUM(CASE WHEN category_id IS NOT NULL THEN amount END), 0) AS spending
       FROM transactions WHERE budget_id = ? AND date BETWEEN ? AND ?`,
    );
    const balances = db.prepare(
      'SELECT SUM(amount) AS bal FROM transactions WHERE budget_id = ? AND date <= ? GROUP BY account_id',
    );
    const periods = [];
    for (let i = request.query.count - 1; i >= 0; i--) {
      const period = periodByLabel(shiftLabel(endLabel, -i), budget.cutoff_day);
      const f = flow.get(budget.id, period.start, period.end);
      let assets = 0;
      let debts = 0;
      for (const { bal } of balances.all(budget.id, period.end)) {
        if (bal >= 0) assets += bal;
        else debts += bal;
      }
      periods.push({
        ...period,
        income: fromCents(f.income),
        spending: fromCents(f.spending),
        assets: fromCents(assets),
        debts: fromCents(debts),
        net_worth: fromCents(assets + debts),
      });
    }
    // Installments marked as debt that have not been charged to an account yet.
    const committed = db.prepare(
      'SELECT COALESCE(SUM(remaining * -amount), 0) AS n FROM recurring WHERE budget_id = ? AND is_debt = 1 AND amount < 0 AND remaining IS NOT NULL',
    ).get(budget.id).n;
    return { periods, committed_debt: fromCents(committed) };
  });

  const labelRange = (query, budget, maxCount = 36) => {
    const endLabel = query.end ? assertLabel(query.end) : periodFor(todayStr(), budget.cutoff_day).label;
    const startLabel = query.start ? assertLabel(query.start) : endLabel;
    const months = (l) => Number(l.slice(0, 4)) * 12 + Number(l.slice(5, 7));
    const count = months(endLabel) - months(startLabel) + 1;
    if (count < 1 || count > maxCount) {
      throw new HttpError(400, 'invalid_range', `"start" must not be after "end", and the range can cover at most ${maxCount} periods.`);
    }
    return Array.from({ length: count }, (_, i) => periodByLabel(shiftLabel(startLabel, i), budget.cutoff_day));
  };

  // Spending per category and income per payee, one column per period.
  app.get('/reports/flow', {
    schema: {
      tags: ['Reports'],
      summary: 'Spending by category and income by payee for a run of periods',
      security,
      querystring: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'Label (YYYY-MM) of the first period. Defaults to "end".' },
          end: { type: 'string', description: 'Label (YYYY-MM) of the last period. Defaults to the current period.' },
          account: { type: 'string', description: 'Only this account (by name).' },
          category: { type: 'string', description: 'Only spending in this category (by name). Income is not filtered.' },
          group: { type: 'string', description: 'Only spending in this category group (by name). Income is not filtered.' },
        },
      },
    },
  }, async (request) => {
    const budget = resolveBudget(app, request);
    const periods = labelRange(request.query, budget);
    const from = periods[0].start;
    const to = periods[periods.length - 1].end;
    const accountId = request.query.account ? findAccount(db, budget.id, request.query.account).id : null;
    const categoryId = request.query.category ? findCategory(db, budget.id, request.query.category).id : null;
    const groupName = request.query.group ? request.query.group.trim().toLowerCase() : null;

    const index = new Map(periods.map((p, i) => [p.label, i]));
    const zeros = () => periods.map(() => 0);
    const cats = new Map(); // id -> row, in budget order
    for (const c of db.prepare(
      `SELECT c.id, c.name, g.name AS grp FROM categories c JOIN category_groups g ON g.id = c.group_id
       WHERE c.budget_id = ? ORDER BY g.sort, g.id, c.sort, c.id`,
    ).all(budget.id)) {
      if (categoryId && c.id !== categoryId) continue;
      if (groupName && c.grp.toLowerCase() !== groupName) continue;
      cats.set(c.id, { category: c.name, group: c.grp, amounts: zeros(), count: 0 });
    }
    const income = new Map(); // payee -> amounts
    let largest = null;

    const rows = db.prepare(
      `SELECT date, amount, payee, category_id FROM transactions
       WHERE budget_id = @budget AND date BETWEEN @from AND @to AND transfer_id IS NULL AND opening = 0
         AND (@account IS NULL OR account_id = @account)`,
    ).all({ budget: budget.id, from, to, account: accountId });
    for (const t of rows) {
      const i = index.get(periodFor(t.date, budget.cutoff_day).label);
      if (t.category_id === null) {
        const payee = t.payee || 'No payee';
        if (!income.has(payee)) income.set(payee, zeros());
        income.get(payee)[i] += t.amount;
        continue;
      }
      const cat = cats.get(t.category_id);
      if (!cat) continue;
      cat.amounts[i] -= t.amount; // spending is positive; refunds reduce it
      if (t.amount < 0) {
        cat.count += 1;
        if (!largest || t.amount < largest.amount) largest = { amount: t.amount, payee: t.payee, category: cat.category, date: t.date };
      }
    }

    const shape = (amounts) => ({ amounts: amounts.map(fromCents), total: fromCents(amounts.reduce((s, n) => s + n, 0)) });
    return {
      periods,
      days: Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1,
      categories: [...cats.values()].filter((c) => c.count || c.amounts.some(Boolean))
        .map((c) => ({ category: c.category, group: c.group, count: c.count, ...shape(c.amounts) })),
      income: [...income.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([payee, amounts]) => ({ payee, ...shape(amounts) })),
      largest_outflow: largest && { ...largest, amount: fromCents(-largest.amount) },
    };
  });

  // Age of money: money is spent oldest first, and the age of an outflow is how
  // long the money it used had been sitting in the accounts. The figure for a
  // date is the average age of the last ten outflows up to that date.
  app.get('/reports/age', {
    schema: {
      tags: ['Reports'],
      summary: 'Age of money at the end of each period',
      security,
      querystring: {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 1, maximum: 36, default: 6 },
          end: { type: 'string', description: 'Label (YYYY-MM) of the last period. Defaults to the current period.' },
        },
      },
    },
  }, async (request) => {
    const budget = resolveBudget(app, request);
    const today = todayStr();
    const endLabel = request.query.end ? assertLabel(request.query.end) : periodFor(today, budget.cutoff_day).label;
    const day = (d) => Date.parse(d) / 86400000;

    const buckets = []; // unspent inflows, oldest first
    let head = 0;
    const outflows = []; // { date, age }
    for (const t of db.prepare(
      'SELECT date, amount FROM transactions WHERE budget_id = ? AND transfer_id IS NULL AND amount <> 0 ORDER BY date, id',
    ).all(budget.id)) {
      if (t.amount > 0) {
        buckets.push({ date: t.date, left: t.amount });
        continue;
      }
      let need = -t.amount;
      let weighted = 0;
      while (need > 0 && head < buckets.length) {
        const b = buckets[head];
        const used = Math.min(need, b.left);
        weighted += used * (day(t.date) - day(b.date));
        b.left -= used;
        need -= used;
        if (b.left === 0) head += 1;
      }
      // Anything not covered by earlier inflows is brand-new money: age 0.
      outflows.push({ date: t.date, age: weighted / -t.amount });
    }

    const ageAt = (date) => {
      const recent = outflows.filter((o) => o.date <= date).slice(-10);
      return recent.length ? Math.round(recent.reduce((s, o) => s + o.age, 0) / recent.length) : null;
    };
    const periods = [];
    for (let i = request.query.count - 1; i >= 0; i--) {
      const period = periodByLabel(shiftLabel(endLabel, -i), budget.cutoff_day);
      periods.push({ ...period, age: period.start > today ? null : ageAt(period.end < today ? period.end : today) });
    }
    return { current: ageAt(today), periods };
  });
}
