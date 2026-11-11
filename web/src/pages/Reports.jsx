import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, periodByLabel, periodFor, periodTitle, shiftLabel, shortDate, todayStr } from '../../../shared/periods.js';
import { qs } from '../api.js';
import { AgeChart, Donut, OTHER, SERIES, SpendingChart, Swatch, WorthChart } from '../charts.jsx';
import { useApp, useData } from '../state.jsx';
import { Empty, ErrorNote, Icon, Money } from '../ui.jsx';

const TABS = [
  ['breakdown', 'Spending Breakdown'],
  ['trends', 'Spending Trends'],
  ['worth', 'Net Worth'],
  ['flow', 'Income v Expense'],
  ['age', 'Age of Money'],
];

// ---- Period naming: calendar months read "Nov 2026", other cutoffs show their dates ----

const isMonth = (p) => p.start.endsWith('-01') && addDays(p.end, 1).endsWith('-01');
const monthName = (p) => `${shortDate(p.start).split(' ')[0]} ${p.start.slice(0, 4)}`;
const pName = (p) => (isMonth(p) ? monthName(p) : periodTitle(p));
const pShort = (p) => (isMonth(p) ? monthName(p) : `${shortDate(p.start)} – ${shortDate(p.end)}`);
const pTick = (p) => (isMonth(p) ? `${p.start.slice(5, 7)}/${p.start.slice(2, 4)}` : shortDate(p.start));
function rangeTitle(periods) {
  const first = periods[0];
  const last = periods[periods.length - 1];
  if (!isMonth(first)) return periodTitle({ start: first.start, end: last.end });
  return periods.length === 1 ? monthName(first) : `${monthName(first)} – ${monthName(last)}`;
}

function useRange(defaultCount) {
  const { budget } = useApp();
  const current = periodFor(todayStr(), budget.cutoff_day).label;
  const [range, setRange] = useState({ end: current, count: defaultCount });
  const start = shiftLabel(range.end, 1 - range.count);
  const periods = Array.from({ length: range.count }, (_, i) => periodByLabel(shiftLabel(start, i), budget.cutoff_day));
  return { ...range, start, periods, current, setRange };
}

function exportCsv(name, rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`; // keep spreadsheets from running it as a formula
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Shared controls ----

function Toolbar({ title, range, counts = [1, 3, 6, 12, 24], onExport, children }) {
  return (
    <div className="mb-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        {onExport && <button type="button" className="link-btn" onClick={onExport}><Icon name="down" size={16} /> Export</button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {range && (
          <>
            <div className="flex w-full items-center rounded-lg border border-line bg-surface md:w-auto">
              <button type="button" className="btn btn-ghost px-2" aria-label="Earlier"
                onClick={() => range.setRange({ end: shiftLabel(range.end, -range.count), count: range.count })}><Icon name="left" size={18} /></button>
              <span className="num flex-1 px-1 text-center text-sm font-semibold whitespace-nowrap">{rangeTitle(range.periods)}</span>
              <button type="button" className="btn btn-ghost px-2" aria-label="Later"
                onClick={() => range.setRange({ end: shiftLabel(range.end, range.count), count: range.count })}><Icon name="right" size={18} /></button>
            </div>
            <select className="input w-auto" value={range.count} aria-label="How many periods"
              onChange={(e) => range.setRange({ end: range.end, count: Number(e.target.value) })}>
              {counts.map((n) => <option key={n} value={n}>{n === 1 ? '1 period' : `${n} periods`}</option>)}
            </select>
            {range.end !== range.current && (
              <button type="button" className="link-btn" onClick={() => range.setRange({ end: range.current, count: range.count })}>Latest</button>
            )}
          </>
        )}
        {children}
      </div>
    </div>
  );
}

function AccountFilter({ value, onChange }) {
  const accounts = useData('/accounts').data || [];
  return (
    <select className="input w-auto max-w-44" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Account">
      <option value="">All accounts</option>
      {accounts.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
    </select>
  );
}

// Value is '' (everything), 'g:<group name>' or 'c:<category name>'.
function CategoryFilter({ value, onChange }) {
  const groups = useData('/budget').data?.groups || [];
  return (
    <select className="input w-auto max-w-44" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Categories">
      <option value="">All categories</option>
      {groups.filter((g) => g.categories.length).map((g) => (
        <optgroup key={g.id} label={g.name}>
          <option value={`g:${g.name}`}>All of {g.name}</option>
          {g.categories.map((c) => <option key={c.id} value={`c:${c.name}`}>{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
const categoryParams = (value) => (value.startsWith('g:') ? { group: value.slice(2) } : value ? { category: value.slice(2) } : {});

function Stat({ label, children, sub }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className="truncate font-semibold">{children}</div>
      {sub && <div className="truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

function Delta({ value, percent, tone = true }) {
  const { money } = useApp();
  if (Math.abs(value) < 0.005) return <span className="num text-muted">{money(0)} (0.0%)</span>;
  const colour = !tone ? 'text-muted' : value > 0 ? 'text-pos' : 'text-neg';
  return (
    <span className={`num whitespace-nowrap ${colour}`}>
      {value > 0 ? '↑ +' : '↓ −'}{money(Math.abs(value))}{percent !== null && ` (${Math.abs(percent).toFixed(1)}%)`}
    </span>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-sunken p-1">
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
          className={`min-h-9 cursor-pointer rounded-md px-3 text-sm font-medium md:min-h-7 ${value === v ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

const Loading = () => <p className="text-muted">Loading…</p>;

// ---- Spending Breakdown ----

function Breakdown() {
  const range = useRange(1);
  const [account, setAccount] = useState('');
  const [filter, setFilter] = useState('');
  const [by, setBy] = useState('categories');
  const { data, error } = useData(`/reports/flow${qs({ start: range.start, end: range.end, account, ...categoryParams(filter) })}`);

  let items = [];
  if (data) {
    if (by === 'groups') {
      const groups = new Map();
      for (const c of data.categories) groups.set(c.group, (groups.get(c.group) || 0) + c.total);
      items = [...groups].map(([name, total]) => ({ name, total }));
    } else items = data.categories.map((c) => ({ name: c.category, group: c.group, total: c.total }));
    items.sort((a, b) => b.total - a.total);
  }
  const total = items.reduce((s, x) => s + x.total, 0);
  const positive = items.filter((x) => x.total > 0);
  // Five named parts at most; the tail folds into "Other".
  const segments = positive.slice(0, 5).map((x, i) => ({ name: x.name, value: x.total, color: SERIES[i] }));
  const rest = positive.slice(5).reduce((s, x) => s + x.total, 0);
  if (rest > 0) segments.push({ name: `Other (${positive.length - 5})`, value: rest, color: OTHER });
  const share = positive.reduce((s, x) => s + x.total, 0) || 1;
  const max = Math.max(0, ...items.map((x) => x.total));
  const frequent = data?.categories.reduce((best, c) => (c.count > (best?.count || 0) ? c : best), null);
  const from = range.periods[0].start;
  const to = range.periods[range.periods.length - 1].end;

  return (
    <>
      <Toolbar title="Spending Breakdown" range={range}
        onExport={data && (() => exportCsv('spending-breakdown', [[by === 'groups' ? 'Group' : 'Category', 'Spending'], ...items.map((x) => [x.name, x.total])]))}>
        <CategoryFilter value={filter} onChange={setFilter} />
        <AccountFilter value={account} onChange={setAccount} />
      </Toolbar>
      <ErrorNote error={error} />
      {!data && !error && <Loading />}
      {data && !items.length && <Empty title="No spending in these dates">Try an earlier period, or clear the filters.</Empty>}
      {data && items.length > 0 && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm text-muted">Total spending</div>
                <Money value={total} className="text-2xl font-semibold" />
              </div>
              <Segmented value={by} onChange={setBy} options={[['categories', 'Categories'], ['groups', 'Groups']]} />
            </div>
            {segments.length > 0 && (
              <div className="grid items-center gap-4 md:grid-cols-2">
                <Donut segments={segments} total={total} label="Total spending" />
                <ul className="space-y-2 text-sm">
                  {segments.map((s) => (
                    <li key={s.name} className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2"><Swatch color={s.color} /><span className="truncate">{s.name}</span></span>
                      <span className="shrink-0"><Money value={s.value} className="font-medium" />
                        <span className="num ml-2 inline-block w-12 text-right text-xs text-muted">{((s.value / share) * 100).toFixed(1)}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="card grid grid-cols-2 gap-4 p-4">
            <Stat label="Average per period"><Money value={total / data.periods.length} /></Stat>
            <Stat label="Average per day"><Money value={total / data.days} /></Stat>
            <Stat label="Most frequent category" sub={frequent ? `${frequent.count} transaction${frequent.count === 1 ? '' : 's'}` : undefined}>{frequent ? frequent.category : '—'}</Stat>
            <Stat label="Largest outflow" sub={data.largest_outflow ? <Money value={data.largest_outflow.amount} /> : undefined}>
              {data.largest_outflow ? data.largest_outflow.payee || data.largest_outflow.category : '—'}
            </Stat>
          </div>

          <div className="card p-4">
            <div className="mb-3 flex justify-between"><span className="section-title">{by === 'groups' ? 'Groups' : 'Categories'}</span><span className="section-title">Total spending</span></div>
            <ul className="space-y-3">
              {items.map((x) => {
                const row = (
                  <>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate group-hover:underline">{x.name} {x.group && <span className="text-xs text-muted">{x.group}</span>}</span>
                      <span className="shrink-0"><Money value={x.total} className="font-medium" />
                        <span className="num ml-2 inline-block w-12 text-right text-xs text-muted">{x.total > 0 ? `${((x.total / share) * 100).toFixed(1)}%` : ''}</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-r bg-sunken">
                      {x.total > 0 && <div className="h-2 rounded-r bg-series-1" style={{ width: `${Math.max(1, (x.total / max) * 100)}%` }} />}
                    </div>
                  </>
                );
                return (
                  <li key={x.name}>
                    {by === 'groups' ? row : <Link to={`/transactions${qs({ category: x.name, from, to, account })}`} className="group block">{row}</Link>}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

// ---- Spending Trends ----

function Trends() {
  const range = useRange(6);
  const [account, setAccount] = useState('');
  const [filter, setFilter] = useState('');
  const { data, error } = useData(`/reports/flow${qs({ start: range.start, end: range.end, account, ...categoryParams(filter) })}`);

  const points = (data?.periods || []).map((p, i) => ({
    name: pName(p),
    tick: pTick(p),
    total: data.categories.reduce((s, c) => s + c.amounts[i], 0),
    top: data.categories.map((c) => ({ name: c.category, value: c.amounts[i] })).filter((c) => c.value > 0).sort((a, b) => b.value - a.value).slice(0, 4),
  }));
  const total = points.reduce((s, p) => s + p.total, 0);
  const average = points.length ? total / points.length : 0;

  return (
    <>
      <Toolbar title="Spending Trends" range={range} counts={[3, 6, 12, 24]}
        onExport={data && (() => exportCsv('spending-trends', [['Period', 'Total spending', 'Compared to average'], ...points.map((p) => [p.name, p.total, Math.round((p.total - average) * 100) / 100])]))}>
        <CategoryFilter value={filter} onChange={setFilter} />
        <AccountFilter value={account} onChange={setAccount} />
      </Toolbar>
      <ErrorNote error={error} />
      {!data && !error && <Loading />}
      {data && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-4 flex flex-wrap gap-x-10 gap-y-3">
              <div>
                <div className="text-sm text-muted">Average spending per period</div>
                <Money value={average} className="text-2xl font-semibold" />
              </div>
              <div>
                <div className="text-sm text-muted">Total spending</div>
                <Money value={total} className="text-lg font-semibold" />
              </div>
            </div>
            <SpendingChart points={points} average={average} />
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="section-title px-4 py-2">Period</th>
                  <th className="section-title px-4 py-2 text-right">Total spending</th>
                  <th className="section-title px-4 py-2 text-right">Compared to average</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...points].reverse().map((p) => (
                  <tr key={p.name}>
                    <td className="num px-4 py-2 whitespace-nowrap">{p.name}</td>
                    <td className="px-4 py-2 text-right"><Money value={p.total} /></td>
                    <td className="px-4 py-2 text-right"><Delta value={p.total - average} percent={average ? ((p.total - average) / average) * 100 : null} tone={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ---- Net Worth ----

function NetWorth() {
  const range = useRange(12);
  const { data, error } = useData(`/reports/trend${qs({ count: range.count, end: range.end })}`);
  const points = (data?.periods || []).map((p, i, all) => {
    const before = i > 0 ? all[i - 1].net_worth : null;
    const change = before === null ? 0 : p.net_worth - before;
    return { ...p, name: pName(p), tick: pTick(p), change, percent: before ? (change / Math.abs(before)) * 100 : null };
  });
  const last = points[points.length - 1];
  const first = points[0];
  const overall = last ? last.net_worth - first.net_worth : 0;

  return (
    <>
      <Toolbar title="Net Worth" range={range} counts={[6, 12, 24]}
        onExport={data && (() => exportCsv('net-worth', [['Period', 'Assets', 'Debts', 'Net worth', 'Change'], ...points.map((p) => [p.name, p.assets, p.debts, p.net_worth, Math.round(p.change * 100) / 100])]))} />
      <ErrorNote error={error} />
      {!data && !error && <Loading />}
      {last && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="text-sm text-muted">Net worth</div>
            <Money value={last.net_worth} className="text-2xl font-semibold" />
            <div className="mt-3 mb-4 grid grid-cols-2 gap-4 md:grid-cols-3">
              <Stat label="Assets"><Money value={last.assets} /></Stat>
              <Stat label="Debts"><Money value={last.debts} /></Stat>
              <div className="col-span-2 md:col-span-1">
                <Stat label="Change over these periods"><Delta value={overall} percent={first.net_worth ? (overall / Math.abs(first.net_worth)) * 100 : null} /></Stat>
              </div>
            </div>
            <WorthChart points={points} />
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="section-title px-4 py-2">Period</th>
                  <th className="section-title px-4 py-2 text-right">Net worth</th>
                  <th className="section-title px-4 py-2 text-right">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...points].reverse().map((p) => (
                  <tr key={p.label}>
                    <td className="num px-4 py-2 whitespace-nowrap">{p.name}</td>
                    <td className="px-4 py-2 text-right"><Money value={p.net_worth} className="font-medium" /></td>
                    <td className="px-4 py-2 text-right"><Delta value={p.change} percent={p.percent} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ---- Income v Expense ----

function Cells({ amounts, sign = 1, signed = false, strong = false }) {
  const total = amounts.reduce((s, n) => s + n, 0);
  return [...amounts, total / amounts.length, total].map((n, i) => (
    // eslint-disable-next-line react/no-array-index-key
    <td key={i} className={`px-3 py-2 text-right ${strong ? 'font-semibold' : ''}`}><Money value={n * sign} signed={signed} /></td>
  ));
}

function IncomeExpense() {
  const range = useRange(6);
  const [account, setAccount] = useState('');
  const { data, error } = useData(`/reports/flow${qs({ start: range.start, end: range.end, account })}`);

  const sum = (rows) => (data?.periods || []).map((_, i) => rows.reduce((s, r) => s + r.amounts[i], 0));
  const groups = [];
  for (const c of data?.categories || []) {
    let g = groups.find((x) => x.name === c.group);
    if (!g) groups.push((g = { name: c.group, rows: [] }));
    g.rows.push(c);
  }
  const income = sum(data?.income || []);
  const expense = sum(data?.categories || []);
  const net = income.map((n, i) => n - expense[i]);
  const first = 'sticky left-0 bg-surface px-4 py-2 text-left font-normal';

  const onExport = data && (() => {
    const line = (name, amounts, sign = 1) => {
      const t = amounts.reduce((s, n) => s + n, 0);
      return [name, ...[...amounts, t / amounts.length, t].map((n) => Math.round(n * sign * 100) / 100)];
    };
    exportCsv('income-v-expense', [
      ['', ...data.periods.map(pName), 'Average', 'Total'],
      ...data.income.map((r) => line(`Income: ${r.payee}`, r.amounts)),
      line('Total income', income),
      ...data.categories.map((c) => line(`${c.group}: ${c.category}`, c.amounts, -1)),
      line('Total expenses', expense, -1),
      line('Net income', net),
    ]);
  });

  return (
    <>
      <Toolbar title="Income v Expense" range={range} counts={[3, 6, 12]} onExport={onExport}>
        <AccountFilter value={account} onChange={setAccount} />
      </Toolbar>
      <ErrorNote error={error} />
      {!data && !error && <Loading />}
      {data && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={first} />
                {[...data.periods.map(pShort), 'Average', 'Total'].map((h) => <th key={h} className="section-title px-3 py-2 text-right whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr><th colSpan={data.periods.length + 3} className="bg-sunken px-4 py-2 text-left text-base font-semibold text-pos"><span className="sticky left-4">Income</span></th></tr>
              {data.income.map((r) => <tr key={r.payee}><th className={`${first} pl-7`}>{r.payee}</th><Cells amounts={r.amounts} /></tr>)}
              <tr><th className={`${first} font-semibold`}>Total income</th><Cells amounts={income} strong /></tr>

              <tr><th colSpan={data.periods.length + 3} className="bg-sunken px-4 py-2 text-left text-base font-semibold text-neg"><span className="sticky left-4">Expenses</span></th></tr>
              {groups.map((g) => (
                <Fragment key={g.name}>
                  <tr><th colSpan={data.periods.length + 3} className="px-4 pt-3 pb-1 text-left text-xs font-semibold tracking-wide text-muted uppercase"><span className="sticky left-4">{g.name}</span></th></tr>
                  {g.rows.map((c) => <tr key={c.category}><th className={`${first} pl-7`}>{c.category}</th><Cells amounts={c.amounts} sign={-1} /></tr>)}
                  <tr><th className={`${first} font-medium`}>Total {g.name}</th><Cells amounts={sum(g.rows)} sign={-1} /></tr>
                </Fragment>
              ))}
              <tr><th className={`${first} font-semibold`}>Total expenses</th><Cells amounts={expense} sign={-1} strong /></tr>

              <tr className="border-t-2 border-line"><th className={`${first} text-base font-semibold`}>Net income</th><Cells amounts={net} signed strong /></tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---- Age of Money ----

function AgeOfMoney() {
  const [count, setCount] = useState(6);
  const { data, error } = useData(`/reports/age?count=${count}`);
  const points = (data?.periods || []).map((p) => ({ ...p, name: pName(p), tick: pTick(p) }));
  return (
    <>
      <Toolbar title="Age of Money"
        onExport={data && (() => exportCsv('age-of-money', [['Period', 'Age of money (days)'], ...points.map((p) => [p.name, p.age ?? ''])]))} />
      <ErrorNote error={error} />
      {!data && !error && <Loading />}
      {data && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm text-muted">Current</div>
                <div className="text-2xl font-semibold">{data.current === null ? 'No spending yet' : `${data.current} day${data.current === 1 ? '' : 's'}`}</div>
              </div>
              <Segmented value={count} onChange={setCount} options={[[6, '6 periods'], [12, '12 periods']]} />
            </div>
            <AgeChart points={points} />
          </div>
          <div className="card p-4 text-sm">
            <h2 className="mb-2 font-semibold">Understanding Age of Money</h2>
            <p className="text-muted">Age of money is how long, on average, money sits in your accounts between arriving and being spent. Knab spends your oldest money first and averages the age of your last ten outflows. A growing number means you are living on older income and have more room to plan.</p>
          </div>
        </div>
      )}
    </>
  );
}

const PAGES = { breakdown: Breakdown, trends: Trends, worth: NetWorth, flow: IncomeExpense, age: AgeOfMoney };

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const tab = PAGES[params.get('tab')] ? params.get('tab') : 'breakdown';
  const Page = PAGES[tab];
  return (
    <div className="max-w-6xl">
      <div className="-mx-4 mb-4 flex gap-5 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] md:mx-0 md:px-0" role="tablist">
        {TABS.map(([value, text]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setParams({ tab: value }, { replace: true })}
            className={`-mb-px min-h-11 shrink-0 cursor-pointer border-b-2 text-sm font-medium whitespace-nowrap ${tab === value ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            {text}
          </button>
        ))}
      </div>
      <Page key={tab} />
    </div>
  );
}
