import { useState } from 'react';
import { nextOccurrence, periodTitle, shortDate, todayStr } from '../../../shared/periods.js';
import { api } from '../api.js';
import { ForecastChart } from '../charts.jsx';
import { store, useApp, useData } from '../state.jsx';
import { Empty, ErrorNote, Field, Icon, Modal, Money, parseAmount, useAction } from '../ui.jsx';

const FREQUENCIES = [['monthly', 'Every month'], ['biweekly', 'Every 2 weeks'], ['weekly', 'Every week'], ['yearly', 'Every year']];
const KINDS = [['installment', 'Installments'], ['ongoing', 'Ongoing'], ['once', 'One time']];
const FILTERS = [['all', 'All'], ['installment', 'Installments'], ['ongoing', 'Ongoing'], ['once', 'One time'], ['income', 'Income']];
const round2 = (n) => Math.round(n * 100) / 100;

function Segmented({ value, onChange, options, label }) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-sunken p-1" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`min-h-10 cursor-pointer rounded-md text-sm font-medium ${value === v ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

// Add or edit a planned item: an installment, an ongoing bill or income, or a one-off.
function PlannedForm({ item, onClose }) {
  const { bump, money } = useApp();
  const accounts = useData('/accounts').data;
  const groups = useData('/categories').data;
  const [type, setType] = useState(item?.type || 'expense');
  const [name, setName] = useState(item?.name || '');
  const [kind, setKind] = useState(item?.kind || 'installment');
  const [amount, setAmount] = useState(item ? String(item.amount) : '');
  const [payments, setPayments] = useState(String(item?.payments || 12));
  const [left, setLeft] = useState(String(item?.payments_left || item?.payments || 12));
  const [total, setTotal] = useState('');
  const [date, setDate] = useState(item?.next_date || todayStr());
  const [frequency, setFrequency] = useState(item?.frequency || 'monthly');
  const [endDate, setEndDate] = useState(item?.end_date || '');
  const [account, setAccount] = useState(item?.account || '');
  const [category, setCategory] = useState(item?.category || '');
  const [auto, setAuto] = useState(item ? item.auto : false);
  const [isDebt, setIsDebt] = useState(item ? item.is_debt : false);
  const [memo, setMemo] = useState(item?.memo || '');

  const open = (accounts || []).filter((a) => !a.closed || a.name === account);
  const accountName = open.some((a) => a.name === account) ? account : open[0]?.name || '';
  const each = parseAmount(amount);
  const count = Math.max(1, Math.min(600, Number.parseInt(payments, 10) || 1));
  const toGo = kind === 'once' ? 1 : Math.max(1, Math.min(count, Number.parseInt(left, 10) || 1));
  const canBeDebt = type === 'expense' && kind !== 'ongoing';

  // Typing a total price works out the amount per payment.
  const onTotal = (text) => {
    setTotal(text);
    const t = parseAmount(text);
    if (t > 0) setAmount(round2(t / count).toFixed(2));
  };
  const typedTotal = parseAmount(total);
  const drift = typedTotal > 0 && each > 0 ? round2(each * count - typedTotal) : 0;

  let last = date;
  if (kind === 'installment' && date) for (let n = 1; n < toGo; n++) last = nextOccurrence(last, frequency, Number(date.slice(8, 10)));

  const [save, saving, saveError] = useAction(async (e) => {
    e.preventDefault();
    if (!(each > 0)) throw new Error('Enter an amount greater than zero.');
    const body = {
      name: name.trim(), type, amount: each, account: accountName, category, date, memo,
      frequency: kind === 'once' ? 'monthly' : frequency,
      auto, is_debt: canBeDebt && isDebt,
      payments: kind === 'installment' ? count : kind === 'once' ? 1 : 0,
      end_date: kind === 'ongoing' ? endDate : '',
    };
    if (kind !== 'ongoing') body.payments_left = toGo;
    if (item) await api('PATCH', `/recurring/${item.id}`, body);
    else await api('POST', '/recurring', body);
    bump();
    onClose();
  });
  const [remove, removing, removeError] = useAction(async () => {
    if (!window.confirm(`Delete "${item.name}" from the forecast? Transactions already entered stay.`)) return;
    await api('DELETE', `/recurring/${item.id}`);
    bump();
    onClose();
  });

  if (accounts && !accounts.length) {
    return <Modal title="Planned item" onClose={onClose}><p className="text-sm text-muted">Add an account first, then you can plan payments from it.</p></Modal>;
  }

  return (
    <Modal title={item ? 'Edit planned item' : 'New planned item'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Segmented label="Direction" value={type} onChange={setType} options={[['expense', 'Expense'], ['income', 'Income']]} />
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus={!item}
            placeholder={type === 'income' ? 'e.g. Salary' : 'e.g. Laptop installment'} />
        </Field>
        <Segmented label="How often" value={kind} onChange={setKind} options={KINDS} />

        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === 'installment' ? 'Amount per payment' : 'Amount'}>
            <input className="input num text-right font-semibold" inputMode="decimal" placeholder="0.00" value={amount}
              onChange={(e) => { setAmount(e.target.value); setTotal(''); }} required />
          </Field>
          {kind === 'installment' ? (
            <Field label="Or total price">
              <input className="input num text-right" inputMode="decimal" value={total} onChange={(e) => onTotal(e.target.value)}
                placeholder={each > 0 ? round2(each * count).toFixed(2) : '0.00'} />
            </Field>
          ) : (
            <Field label={kind === 'once' ? 'Date' : 'Next date'}>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
          )}
        </div>

        {kind === 'installment' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Number of payments">
                <input className="input num text-right" inputMode="numeric" value={payments} required
                  onChange={(e) => {
                    setPayments(e.target.value);
                    // A new item starts with every payment still to go.
                    if (!item) setLeft(e.target.value);
                    const t = parseAmount(total);
                    const n = Number.parseInt(e.target.value, 10);
                    if (t > 0 && n > 0) setAmount(round2(t / n).toFixed(2));
                  }} />
              </Field>
              <Field label="Payments still to go">
                <input className="input num text-right" inputMode="numeric" value={left} onChange={(e) => setLeft(e.target.value)} required />
              </Field>
            </div>
            {each > 0 && (
              <p className="rounded-lg bg-sunken px-3 py-2 text-sm">
                <strong>{toGo} payment{toGo === 1 ? '' : 's'} left, {money(each * toGo)} still to pay.</strong> Last one on {shortDate(last, true)}.
                {' '}Change "still to go" any time if the count was entered wrong; payments already entered are not touched.
                {Math.abs(drift) >= 0.01 && ` ${count} × ${money(each)} is ${money(Math.abs(drift))} ${drift > 0 ? 'more' : 'less'} than the total; adjust the last payment when you enter it.`}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Next payment date">
                <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </Field>
              <Field label="Repeats">
                <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                  {FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
            </div>
          </>
        )}
        {kind === 'ongoing' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Repeats">
              <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                {FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Until (optional)">
              <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={type === 'income' ? 'Account it arrives in' : 'Account it will be charged to'}>
            <select className="input" value={accountName} onChange={(e) => setAccount(e.target.value)}>
              {open.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} required={type === 'expense'}>
              <option value="">{type === 'income' ? 'Ready to Assign' : 'Choose a category…'}</option>
              {(groups || []).map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {g.categories.filter((c) => !c.hidden || c.name === category).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
        </div>

        <fieldset className="rounded-lg border border-line px-3 pb-2">
          <legend className="px-1 text-xs font-medium text-muted">When it is due</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="radio" name="entry" className="size-5 accent-(--accent)" checked={!auto} onChange={() => setAuto(false)} />
            <span><strong>Wait for me</strong> <span className="text-muted">— it stays in Forecast until I press "Enter now"</span></span>
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="radio" name="entry" className="size-5 accent-(--accent)" checked={auto} onChange={() => setAuto(true)} />
            <span><strong>Enter automatically</strong> <span className="text-muted">— add the transaction on its date</span></span>
          </label>
        </fieldset>

        {canBeDebt && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-sunken px-3 py-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 size-5 accent-(--accent)" checked={isDebt} onChange={(e) => setIsDebt(e.target.checked)} />
            <span><strong>This is a debt I already owe</strong><br />
              <span className="text-muted">Counts what is still to pay as debt in Net Worth and in "Committed, not yet charged". Leave it off for bills and plans you could still cancel.</span></span>
          </label>
        )}

        <Field label="Memo">
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} placeholder="Optional note" />
        </Field>

        <ErrorNote error={saveError || removeError} />
        <div className="flex gap-3">
          {item && <button type="button" className="btn btn-danger" onClick={remove} disabled={removing}>Delete</button>}
          <button className="btn btn-primary flex-1" disabled={saving || !accounts}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

// "Enter now": confirm or adjust one occurrence before it becomes a transaction.
function EnterDialog({ occurrence, onClose }) {
  const { bump } = useApp();
  const [amount, setAmount] = useState(occurrence.amount.toFixed(2));
  const [date, setDate] = useState(occurrence.date);
  const [memo, setMemo] = useState('');
  const [cleared, setCleared] = useState(false);
  const [save, saving, error] = useAction(async (e) => {
    e.preventDefault();
    const value = parseAmount(amount);
    if (!(value > 0)) throw new Error('Enter an amount greater than zero.');
    await api('POST', `/recurring/${occurrence.item_id}/enter`, { amount: value, date, cleared, ...(memo.trim() ? { memo } : {}) });
    bump();
    onClose();
  });
  return (
    <Modal title="Enter transaction" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-sm">
          <strong>{occurrence.name}</strong>{occurrence.number ? `, payment ${occurrence.number} of ${occurrence.of}` : ''}
          <span className="text-muted"> · {occurrence.account}{occurrence.category ? ` · ${occurrence.category}` : ''}</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <input className="input num text-right font-semibold" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <Field label="Memo" hint="Leave empty to use the planned item's memo.">
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} />
        </Field>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-(--accent)" checked={cleared} onChange={(e) => setCleared(e.target.checked)} />
          Cleared at the bank
        </label>
        <p className="text-xs text-muted">This adds a {occurrence.type === 'income' ? 'deposit to' : 'charge on'} {occurrence.account} and moves the plan on to its next date. Changing the amount here affects only this entry.</p>
        <ErrorNote error={error} />
        <button className="btn btn-primary w-full" disabled={saving}>Enter transaction</button>
      </form>
    </Modal>
  );
}

function Tile({ label, children, sub }) {
  return (
    <div className="card min-w-0 px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="truncate text-lg font-semibold md:text-xl">{children}</div>
      <div className="truncate text-xs text-muted">{sub}</div>
    </div>
  );
}

function When({ o }) {
  return (
    <span className="whitespace-nowrap">
      {shortDate(o.date)}
      {o.overdue && <strong className="ml-1.5 text-neg">overdue</strong>}
      {o.due_today && <strong className="ml-1.5 text-accent">today</strong>}
    </span>
  );
}

export default function Forecast() {
  const { bump, money } = useApp();
  const { data, error } = useData('/forecast?periods=12');
  const wide = typeof window !== 'undefined' && window.innerWidth >= 768;
  const [summary, setSummary] = useState(() => (store.get('knab-forecast-summary') ?? (wide ? '1' : '0')) === '1');
  const [compare, setCompare] = useState(() => store.get('knab-forecast-compare') !== '0');
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState(null); // null | {} | item
  const [entering, setEntering] = useState(null);
  const [actionError, setActionError] = useState(null);

  const run = (fn) => fn().then(() => { setActionError(null); bump(); }).catch(setActionError);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <p className="text-muted">Loading…</p>;

  const { periods, items, summary: s } = data;
  const period = periods.find((p) => p.label === selected) || periods[0];
  const isCurrent = period === periods[0];
  const points = periods.map((p) => ({ ...p, name: periodTitle(p), tick: shortDate(p.start) }));
  const shown = items.filter((it) => (filter === 'all' ? true : filter === 'income' ? it.type === 'income' : it.type === 'expense' && it.kind === filter));
  const byId = new Map(items.map((it) => [it.id, it]));
  const dueNow = periods[0].occurrences.filter((o) => !o.auto && (o.overdue || o.due_today));

  const toggleSummary = () => { store.set('knab-forecast-summary', summary ? '0' : '1'); setSummary(!summary); };
  const toggleCompare = () => { store.set('knab-forecast-compare', compare ? '0' : '1'); setCompare(!compare); };
  const skip = (o) => {
    if (!window.confirm(`Skip ${o.name} on ${shortDate(o.date, true)}? It will not be entered, and the plan moves on to its next date.`)) return;
    run(() => api('POST', `/recurring/${o.item_id}/skip`));
  };
  const enterAll = () => {
    // One item can be due more than once, so list each occurrence that is due.
    const lines = dueNow.map((o) => `• ${o.name}  ${money(o.amount)}`).join('\n');
    if (!window.confirm(`Enter everything that is due today or overdue?\n\n${lines}\n\nEach becomes a transaction at its planned amount and date.`)) return;
    run(() => api('POST', '/recurring/enter-due'));
  };

  const action = (o) => {
    if (o.auto) return <span className="text-xs text-muted">Enters automatically</span>;
    if (!o.actionable) return <span className="text-xs text-muted">After the earlier one</span>;
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <button type="button" className={`btn min-h-9 px-3 md:min-h-8 ${o.overdue || o.due_today ? 'btn-primary' : ''}`} onClick={() => setEntering(o)}>Enter now</button>
        <button type="button" className="btn btn-ghost min-h-9 px-2 text-muted md:min-h-8" onClick={() => skip(o)}>Skip</button>
      </span>
    );
  };
  const detail = (o) => (o.number ? `installment ${o.number} of ${o.of}` : o.kind === 'once' ? 'one time' : '');
  const gap = period.total - period.assigned;

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold md:text-2xl">Forecast</h1>
          <p className="text-sm text-muted">What you already know is coming, for the next {periods.length} periods.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn" onClick={toggleSummary} aria-expanded={summary}>
            <Icon name={summary ? 'down' : 'right'} size={16} /> Summary
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setForm({})}><Icon name="plus" size={18} /> Planned item</button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="This period, still to pay" sub={`${s.this_period.count} item${s.this_period.count === 1 ? '' : 's'}, ${periodTitle(s.this_period)}`}><Money value={s.this_period.total} /></Tile>
          <Tile label="Heaviest period" sub={s.heaviest ? periodTitle(s.heaviest) : 'Nothing planned yet'}>{s.heaviest ? <Money value={s.heaviest.total} /> : '—'}</Tile>
          <Tile label="Committed, not yet charged" sub={s.debt_items ? `${s.debt_items} item${s.debt_items === 1 ? '' : 's'} marked as debt` : 'Nothing marked as debt'}><Money value={s.committed_debt} /></Tile>
          <Tile label="When it eases" sub={s.eases ? (s.eases.finished.length ? `${s.eases.finished.join(', ')} paid off by then` : 'Lighter than now from then on') : 'No lighter stretch in view'}>
            {s.eases ? `From ${shortDate(s.eases.start)}` : '—'}
          </Tile>
        </div>
      )}

      <ErrorNote error={actionError} />

      {!items.length ? (
        <Empty title="Nothing planned yet">
          <p>Add installments, bills, one-off expenses and expected income to see what is coming.</p>
          <button className="btn btn-primary mt-3" onClick={() => setForm({})}>Add a planned item</button>
        </Empty>
      ) : (
        <>
          <section className="card p-4" aria-label="Planned expenses per period">
            <div className="mb-1 flex flex-wrap items-center justify-end gap-3">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm md:min-h-8">
                <input type="checkbox" className="size-5 accent-(--accent) md:size-4" checked={compare} onChange={toggleCompare} />
                Compare with income and assigned
              </label>
            </div>
            <ForecastChart points={points} compare={compare} selected={period.label} onSelect={setSelected} />
            <p className="mt-1 text-xs text-muted">Select a bar to see that period below.</p>
            {compare && (
              <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-3">
                <div><div className="text-xs text-muted">{periodTitle(period)}: planned</div><Money value={period.total} className="font-semibold" /></div>
                <div>
                  <div className="text-xs text-muted">Expected income</div>
                  <Money value={period.income} className="font-semibold" />{' '}
                  {period.income > 0 && <span className={`text-sm ${period.income >= period.total ? 'text-pos' : 'text-neg'}`}>{period.income >= period.total ? 'leaves' : 'short by'} {money(Math.abs(period.income - period.total))}</span>}
                </div>
                <div>
                  <div className="text-xs text-muted">Already assigned in this period</div>
                  <Money value={period.assigned} className="font-semibold" />{' '}
                  {period.total > 0 && <span className={`text-sm ${gap > 0.005 ? 'text-neg' : 'text-pos'}`}>{gap > 0.005 ? `${money(gap)} not yet assigned` : 'covers the plan'}</span>}
                </div>
              </div>
            )}
          </section>

          <section className="card overflow-hidden" aria-label="Selected period">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-sunken px-4 py-2.5">
              <div>
                <span className="font-semibold">{periodTitle(period)}</span>{' '}
                <span className="text-sm text-muted">· {period.occurrences.length} planned · {money(period.total)}</span>
              </div>
              {isCurrent && dueNow.length > 0 && <button type="button" className="btn" onClick={enterAll}>Enter all due ({dueNow.length})</button>}
            </div>
            {!period.occurrences.length && <p className="px-4 py-6 text-center text-sm text-muted">Nothing planned in this period.</p>}

            {/* Phone: one card per occurrence */}
            <ul className="divide-y divide-line md:hidden">
              {period.occurrences.map((o) => (
                <li key={`${o.item_id}-${o.date}`} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${o.overdue && !o.auto ? 'bg-neg-bg' : ''}`}>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{o.name} <span className="font-normal text-muted">{detail(o)}</span></div>
                    <div className="truncate text-xs text-muted"><When o={o} /> · {o.account}</div>
                    <div className="mt-1">{action(o)}</div>
                  </div>
                  <Money value={o.amount} signed={o.type === 'income'} className="shrink-0 text-sm font-semibold" />
                </li>
              ))}
            </ul>
            {/* Desktop: a table */}
            {period.occurrences.length > 0 && (
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      {['Due', 'Item', 'Category', 'Account'].map((h) => <th key={h} className="section-title px-4 py-2">{h}</th>)}
                      <th className="section-title px-4 py-2 text-right">Amount</th>
                      <th className="section-title px-4 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {period.occurrences.map((o) => (
                      <tr key={`${o.item_id}-${o.date}`} className={o.overdue && !o.auto ? 'bg-neg-bg' : ''}>
                        <td className="px-4 py-2"><When o={o} /></td>
                        <td className="px-4 py-2">
                          <button type="button" className="cursor-pointer font-medium hover:underline" onClick={() => setForm(byId.get(o.item_id))}>{o.name}</button>{' '}
                          <span className="text-muted">{detail(o)}</span>
                        </td>
                        <td className="px-4 py-2">{o.category || (o.type === 'income' ? 'Ready to Assign' : '')}</td>
                        <td className="px-4 py-2">{o.account}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap"><Money value={o.amount} signed={o.type === 'income'} /></td>
                        <td className="px-4 py-1.5 text-right">{action(o)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card overflow-hidden" aria-label="Planned items">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <h2 className="font-semibold">Planned items</h2>
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Filter planned items">
                {FILTERS.map(([v, text]) => <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)} className={`chip ${filter === v ? 'chip-on' : ''}`}>{text}</button>)}
              </div>
            </div>
            {!shown.length && <p className="px-4 py-6 text-center text-sm text-muted">No planned items of this kind.</p>}
            <ul className="divide-y divide-line">
              {shown.map((it) => {
                const paid = it.payments !== null ? it.payments - it.payments_left : 0;
                return (
                  <li key={it.id}>
                    <button type="button" onClick={() => setForm(it)} title="Edit"
                      className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left hover:bg-sunken md:grid-cols-[minmax(0,1.6fr)_7rem_minmax(0,1.2fr)_8rem_7rem]">
                      <span className="min-w-0">
                        <span className="font-medium">{it.name}</span>
                        {it.is_debt && <span className="ml-2 rounded-full bg-neg-bg px-2 py-0.5 text-[11px] font-semibold text-neg">Debt</span>}
                        <span className="block truncate text-xs text-muted">
                          {it.category || (it.type === 'income' ? 'Ready to Assign' : '')} · {it.account} · next {shortDate(it.next_date, true)} · {it.auto ? 'automatic' : 'waits for you'}
                        </span>
                      </span>
                      <Money value={it.amount} signed={it.type === 'income'} className="text-right text-sm font-semibold whitespace-nowrap" />
                      <span className="col-span-2 min-w-0 md:col-span-1">
                        {it.kind === 'installment' ? (
                          <>
                            <span className="text-xs">{paid} of {it.payments} paid, {it.payments_left} left</span>
                            <span className="mt-1 block h-1.5 rounded-full bg-sunken"><span className="block h-1.5 rounded-full bg-series-1" style={{ width: `${Math.round((paid / it.payments) * 100)}%` }} /></span>
                          </>
                        ) : <span className="text-xs text-muted">{it.kind === 'once' ? 'One time' : it.end_date ? `Until ${shortDate(it.end_date, true)}` : 'No end date'}</span>}
                      </span>
                      <span className="hidden text-right text-sm md:block">{it.left_to_pay !== null ? <Money value={it.left_to_pay} /> : <span className="text-muted">—</span>}</span>
                      <span className="hidden text-sm text-muted md:block">{it.kind === 'ongoing' ? '' : `ends ${shortDate(it.last_date, true)}`}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {form && <PlannedForm item={form.id ? form : null} onClose={() => setForm(null)} />}
      {entering && <EnterDialog occurrence={entering} onClose={() => setEntering(null)} />}
    </div>
  );
}
