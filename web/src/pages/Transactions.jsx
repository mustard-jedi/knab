import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { periodByLabel, periodFor, shortDate, todayStr } from '../../../shared/periods.js';
import { qs } from '../api.js';
import { useApp, useData } from '../state.jsx';
import { Empty, ErrorNote, Icon, Money, PageHeader, PeriodSwitcher } from '../ui.jsx';

const PAGE = 200;

function describe(t) {
  if (t.type === 'transfer') return t.signed_amount < 0 ? `Transfer to ${t.transfer_account}` : `Transfer from ${t.transfer_account}`;
  return t.payee || (t.type === 'income' ? 'Income' : 'Expense');
}
const categoryText = (t) => (t.type === 'transfer' ? '' : t.category || (t.signed_amount > 0 ? 'Ready to Assign' : 'Uncategorised'));

export default function Transactions() {
  const { budget, openTxForm } = useApp();
  const [params, setParams] = useSearchParams();
  const account = params.get('account') || '';
  const category = params.get('category') || '';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const all = params.get('range') === 'all';
  const current = periodFor(todayStr(), budget.cutoff_day);

  // The default view is the current cutoff period. A from/to pair that matches
  // a whole period keeps the period switcher; anything else is a custom range.
  const matched = from && to ? periodFor(from, budget.cutoff_day) : null;
  const isPeriod = !all && ((!from && !to) || Boolean(matched && matched.start === from && matched.end === to));
  const period = matched || current;
  const range = all ? {} : { from: from || current.start, to: to || current.end };

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { const id = setTimeout(() => setQ(search.trim()), 250); return () => clearTimeout(id); }, [search]);
  useEffect(() => { setLimit(PAGE); }, [account, category, from, to, all, q]);

  const accounts = useData('/accounts').data;
  const { data, error } = useData(`/transactions${qs({ account, category, ...range, q, limit })}`);

  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    setParams(next, { replace: true });
  };
  const setPeriod = (label) => {
    const p = periodByLabel(label, budget.cutoff_day);
    update({ from: p.start, to: p.end, range: '' });
  };

  const rows = data?.transactions || [];
  const accountInfo = accounts?.find((a) => a.name.toLowerCase() === account.toLowerCase());

  return (
    <div>
      <PageHeader title={account || 'All transactions'}>
        <div className="flex items-center gap-2">
          <Link className="btn" to="/scheduled"><Icon name="repeat" size={18} /> Scheduled</Link>
          <button className="btn btn-primary hidden md:inline-flex" onClick={() => openTxForm({ defaults: { account, category } })}><Icon name="plus" size={18} /> Add</button>
        </div>
      </PageHeader>

      <div className="mb-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-center">
          <select className="input md:w-48" value={accountInfo?.name || ''} onChange={(e) => update({ account: e.target.value })} aria-label="Account">
            <option value="">All accounts</option>
            {(accounts || []).map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
          <select className="input md:w-40" value={all ? 'all' : isPeriod ? 'period' : 'custom'} aria-label="Dates"
            onChange={(e) => {
              if (e.target.value === 'all') update({ range: 'all', from: '', to: '' });
              else if (e.target.value === 'period') update({ range: '', from: '', to: '' });
              else update({ range: '', from: range.from || current.start, to: todayStr() });
            }}>
            <option value="period">By period</option>
            <option value="custom">Custom dates</option>
            <option value="all">All dates</option>
          </select>
          <input className="input col-span-2 md:w-56 md:flex-1" type="search" placeholder="Search payee, memo, category" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        </div>
        {isPeriod && <PeriodSwitcher label={period.label} onChange={setPeriod} currentLabel={current.label} />}
        {!all && !isPeriod && (
          <div className="grid grid-cols-2 gap-3 md:flex">
            <input className="input md:w-44" type="date" value={from} onChange={(e) => update({ from: e.target.value })} aria-label="From date" />
            <input className="input md:w-44" type="date" value={to} onChange={(e) => update({ to: e.target.value })} aria-label="To date" />
          </div>
        )}
        {category && (
          <button className="btn" onClick={() => update({ category: '' })}>Category: {category} <Icon name="close" size={16} /></button>
        )}
      </div>

      <ErrorNote error={error} />
      {data && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-sm text-muted">
          <span>{data.total} transaction{data.total === 1 ? '' : 's'} · net <Money value={data.net} signed className="font-medium" /></span>
          {accountInfo && <span>Balance today <Money value={accountInfo.balance} signed className="font-semibold" /></span>}
        </div>
      )}

      {data && !rows.length && <Empty title="No transactions here">Try another period or account, or add one with the + button.</Empty>}

      {rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[6rem_9rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_7.5rem_2rem] gap-3 border-b border-line px-4 py-2 md:grid">
            {['Date', 'Account', 'Payee', 'Category', 'Memo'].map((h) => <span key={h} className="section-title">{h}</span>)}
            <span className="section-title text-right">Amount</span>
            <span className="section-title" title="Cleared">C</span>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => openTxForm({ transaction: t })}
                  className="block w-full cursor-pointer px-4 py-2.5 text-left hover:bg-sunken">
                  {/* Phone: two lines */}
                  <span className="flex items-center justify-between gap-3 md:hidden">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{describe(t)}</span>
                      <span className="block truncate text-xs text-muted">
                        {shortDate(t.date, t.date.slice(0, 4) !== todayStr().slice(0, 4))}{!account && ` · ${t.account}`}{categoryText(t) && ` · ${categoryText(t)}`}
                      </span>
                    </span>
                    <Money value={t.signed_amount} signed className="shrink-0 text-sm font-semibold" />
                  </span>
                  {/* Desktop: one grid row */}
                  <span className="hidden grid-cols-[6rem_9rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_7.5rem_2rem] items-center gap-3 text-sm md:grid">
                    <span className="num text-muted">{t.date}</span>
                    <span className="truncate">{t.account}</span>
                    <span className="truncate font-medium">{describe(t)}</span>
                    <span className="truncate text-muted">{categoryText(t)}</span>
                    <span className="truncate text-muted">{t.memo}</span>
                    <Money value={t.signed_amount} signed className="text-right font-semibold" />
                    <span className="text-pos" title={t.cleared ? 'Cleared' : 'Not cleared'}>{t.cleared && <Icon name="check" size={16} />}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data && data.total > rows.length && (
        <button className="btn mt-4 w-full" onClick={() => setLimit((l) => Math.min(l + PAGE, 1000))} disabled={limit >= 1000}>
          {limit >= 1000 ? 'Showing the first 1,000 — narrow the dates to see more' : 'Show more'}
        </button>
      )}
    </div>
  );
}
