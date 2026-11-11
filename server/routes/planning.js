// The envelope budget view, assigning money, and reports.
//
// Nothing here is stored pre-computed. For a period P ending on date E:
//   available(category) = all money ever assigned up to P + all its transactions up to E
//   ready_to_assign     = all uncategorised, non-transfer money up to E - everything assigned up to P
// so Ready to Assign + the sum of every Available always equals the total of
// all account balances on E.
import { resolveBudget } from '../auth.js';
import { toCents, fromCents, assertDate, assertLabel } from '../util.js';
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
    return { periods };
  });
}
