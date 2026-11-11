import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { periodByLabel, periodFor, shortDate, todayStr } from '../../../shared/periods.js';
import { api, qs } from '../api.js';
import { useApp, useData } from '../state.jsx';
import { Empty, ErrorNote, Icon, Money, PeriodSwitcher, useAction } from '../ui.jsx';
import { AccountForm } from './Accounts.jsx';

const PAGE = 200;
const TYPE_LABEL = { checking: 'Checking', savings: 'Savings', cash: 'Cash', credit: 'Credit card', other: 'Other' };

const payeeText = (t) => (t.type === 'transfer' ? `Transfer: ${t.transfer_account}` : t.payee);
function categoryText(t) {
  if (t.type === 'transfer') return 'Category not needed';
  if (t.category) return `${t.category_group}: ${t.category}`;
  return t.signed_amount > 0 ? 'Inflow: Ready to Assign' : 'Uncategorised';
}
const longDate = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

function Balance({ label, value }) {
  return (
    <div>
      <Money value={value} signed className="text-base font-semibold md:text-lg" />
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function ClearedButton({ transaction }) {
  const { bump } = useApp();
  const [toggle, busy] = useAction(async (e) => {
    e.stopPropagation();
    await api('PATCH', `/transactions/${transaction.id}`, { cleared: !transaction.cleared });
    bump();
  });
  return (
    <button type="button" onClick={toggle} disabled={busy} aria-pressed={transaction.cleared}
      aria-label={transaction.cleared ? 'Cleared. Mark as not cleared' : 'Not cleared. Mark as cleared'}
      title={transaction.cleared ? 'Cleared' : 'Not cleared'}
      className={`flex size-6 cursor-pointer items-center justify-center rounded-full border text-[11px] font-bold ${transaction.cleared ? 'border-pos bg-pos text-surface' : 'border-line text-muted hover:border-pos hover:text-pos'}`}>
      C
    </button>
  );
}

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
  const [editingAccount, setEditingAccount] = useState(false);
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
  const info = accounts?.find((a) => a.name.toLowerCase() === account.toLowerCase());
  const scope = info ? [info] : accounts || [];
  const working = scope.reduce((s, a) => s + a.balance, 0);
  const cleared = scope.reduce((s, a) => s + a.cleared_balance, 0);
  const showAccount = !info;
  const grid = showAccount
    ? 'md:grid-cols-[6rem_8rem_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_7rem_7rem_2rem]'
    : 'md:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_7rem_7rem_2rem]';
  const open = (t) => openTxForm({ transaction: t });

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold md:text-2xl">{info ? info.name : 'All accounts'}</h1>
          <p className="text-xs text-muted">{info ? `${TYPE_LABEL[info.type] || info.type}${info.closed ? ' · Closed' : ''}` : `${scope.length} account${scope.length === 1 ? '' : 's'}`}</p>
        </div>
        {info && (
          <button className="btn shrink-0 px-3" onClick={() => setEditingAccount(true)} aria-label="Edit account"><Icon name="edit" size={16} /><span className="hidden md:inline">Edit</span></button>
        )}
      </div>

      {accounts && (
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-line py-3">
          <Balance label="Cleared balance" value={cleared} />
          <span className="text-muted">+</span>
          <Balance label="Uncleared balance" value={working - cleared} />
          <span className="text-muted">=</span>
          <Balance label="Working balance" value={working} />
        </div>
      )}

      <div className="mb-3 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button className="link-btn hidden md:inline-flex" onClick={() => openTxForm({ defaults: { account: info?.name, category } })}><Icon name="plus" size={16} /> Add transaction</button>
          <Link className="link-btn" to="/scheduled"><Icon name="repeat" size={16} /> Scheduled</Link>
          <select className="input w-auto md:hidden" value={info?.name || ''} onChange={(e) => update({ account: e.target.value })} aria-label="Account">
            <option value="">All accounts</option>
            {(accounts || []).map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
          <select className="input w-auto" value={all ? 'all' : isPeriod ? 'period' : 'custom'} aria-label="Dates"
            onChange={(e) => {
              if (e.target.value === 'all') update({ range: 'all', from: '', to: '' });
              else if (e.target.value === 'period') update({ range: '', from: '', to: '' });
              else update({ range: '', from: range.from || current.start, to: todayStr() });
            }}>
            <option value="period">By period</option>
            <option value="custom">Custom dates</option>
            <option value="all">All dates</option>
          </select>
          <input className="input w-full md:ml-auto md:w-64" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${info ? info.name : 'all accounts'}`} aria-label="Search" />
        </div>
        {isPeriod && <div className="md:w-fit"><PeriodSwitcher label={period.label} onChange={setPeriod} currentLabel={current.label} /></div>}
        {!all && !isPeriod && (
          <div className="grid grid-cols-2 gap-3 md:flex">
            <input className="input md:w-44" type="date" value={from} onChange={(e) => update({ from: e.target.value })} aria-label="From date" />
            <input className="input md:w-44" type="date" value={to} onChange={(e) => update({ to: e.target.value })} aria-label="To date" />
          </div>
        )}
        {category && <button className="chip chip-on" onClick={() => update({ category: '' })}>Category: {category} <Icon name="close" size={14} /></button>}
      </div>

      <ErrorNote error={error} />
      {data && !rows.length && <Empty title="No transactions here">Try another period or account, or add one with the + button.</Empty>}

      {rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className={`hidden gap-3 border-b border-line bg-sunken px-4 py-2 md:grid ${grid}`}>
            <span className="section-title">Date</span>
            {showAccount && <span className="section-title">Account</span>}
            <span className="section-title">Payee</span>
            <span className="section-title">Category</span>
            <span className="section-title">Memo</span>
            <span className="section-title text-right">Outflow</span>
            <span className="section-title text-right">Inflow</span>
            <span className="section-title text-center" title="Cleared">C</span>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((t) => (
              <li key={t.id} role="button" tabIndex={0} onClick={() => open(t)}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(t); } }}
                className="cursor-pointer px-4 py-2.5 hover:bg-sunken md:py-1.5">
                {/* Phone: two lines */}
                <div className="flex items-center justify-between gap-3 md:hidden">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{payeeText(t) || (t.type === 'income' ? 'Income' : 'Expense')}</div>
                    <div className="truncate text-xs text-muted">
                      {shortDate(t.date, t.date.slice(0, 4) !== todayStr().slice(0, 4))}{showAccount && ` · ${t.account}`}{t.type !== 'transfer' && ` · ${t.category || (t.signed_amount > 0 ? 'Ready to Assign' : 'Uncategorised')}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Money value={t.signed_amount} signed className="text-sm font-semibold" />
                    <ClearedButton transaction={t} />
                  </div>
                </div>
                {/* Desktop: one grid row */}
                <div className={`hidden items-center gap-3 text-sm md:grid ${grid}`}>
                  <span className="num">{longDate(t.date)}</span>
                  {showAccount && <span className="truncate">{t.account}</span>}
                  <span className="truncate">{payeeText(t)}</span>
                  <span className={`truncate ${t.type === 'transfer' ? 'text-muted' : ''}`}>{categoryText(t)}</span>
                  <span className="truncate text-muted">{t.memo}</span>
                  <span className="num text-right">{t.signed_amount < 0 && <Money value={t.amount} />}</span>
                  <span className="num text-right">{t.signed_amount > 0 && <Money value={t.amount} />}</span>
                  <span className="flex justify-center"><ClearedButton transaction={t} /></span>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-sunken px-4 py-2 text-xs text-muted">
            <span>{data.total} transaction{data.total === 1 ? '' : 's'} shown for these dates</span>
            <span>Net <Money value={data.net} signed className="font-semibold" /></span>
          </div>
        </div>
      )}
      {data && data.total > rows.length && (
        <button className="btn mt-4 w-full" onClick={() => setLimit((l) => Math.min(l + PAGE, 1000))} disabled={limit >= 1000}>
          {limit >= 1000 ? 'Showing the first 1,000 — narrow the dates to see more' : 'Show more'}
        </button>
      )}
      {editingAccount && info && <AccountForm account={info} onClose={() => setEditingAccount(false)} />}
    </div>
  );
}
