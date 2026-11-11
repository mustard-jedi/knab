import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp, useData } from '../state.jsx';
import { Empty, ErrorNote, Money, PeriodSwitcher, parseAmount } from '../ui.jsx';

const COLS = 'grid grid-cols-2 items-center gap-x-3 gap-y-1 px-4 md:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_8.5rem]';

function AssignInput({ category, period, value, onError }) {
  const { bump } = useApp();
  const [text, setText] = useState(value ? value.toFixed(2) : '');
  useEffect(() => { setText(value ? value.toFixed(2) : ''); }, [value, period]);

  async function commit() {
    const next = text.trim() === '' ? 0 : parseAmount(text);
    if (Number.isNaN(next)) return setText(value ? value.toFixed(2) : '');
    if (Math.abs(next - value) < 0.005) return undefined;
    try {
      await api('PUT', '/budget/assign', { category, period, amount: Math.round(next * 100) / 100 });
      onError(null);
      bump();
    } catch (err) {
      onError(err);
    }
    return undefined;
  }

  return (
    <input className="input num text-right md:min-h-8" inputMode="decimal" placeholder="0.00" value={text}
      aria-label={`Assigned to ${category}`}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
  );
}

function Available({ value }) {
  const tone = value < -0.005 ? 'bg-neg-bg text-neg' : value > 0.005 ? 'bg-pos-bg text-pos' : 'bg-sunken text-muted';
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-semibold ${tone}`}><Money value={value} /></span>;
}

export default function Budget() {
  const { budget } = useApp();
  const [label, setLabel] = useState(null);
  const { data, error } = useData(`/budget${qs({ period: label })}`);
  const [assignError, setAssignError] = useState(null);
  useEffect(() => { setLabel(null); }, [budget.id, budget.cutoff_day]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <p className="text-muted">Loading…</p>;

  const { period, ready_to_assign: rta } = data;
  const rtaTone = rta < -0.005 ? 'border-neg bg-neg-bg text-neg' : rta > 0.005 ? 'border-pos bg-pos-bg text-pos' : 'border-line bg-surface text-muted';
  const rtaText = rta < -0.005 ? 'You assigned more than you have' : rta > 0.005 ? 'Ready to assign' : 'All money assigned';
  const hasCategories = data.groups.some((g) => g.categories.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <PeriodSwitcher label={period.label} onChange={setLabel} currentLabel={data.current_period} />
        <div className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-2.5 ${rtaTone}`}>
          <span className="text-sm font-medium">{rtaText}</span>
          <span className="num text-xl font-semibold"><Money value={rta} /></span>
        </div>
      </div>

      <ErrorNote error={assignError} />

      {!hasCategories ? (
        <Empty title="No categories yet">Add categories under <Link className="text-accent underline" to="/settings">Settings</Link> to start budgeting.</Empty>
      ) : (
        <div className="card overflow-hidden">
          <div className={`${COLS} hidden border-b border-line py-2 md:grid`}>
            <span className="section-title">Category</span>
            <span className="section-title text-right">Assigned</span>
            <span className="section-title text-right">Activity</span>
            <span className="section-title text-right">Available</span>
          </div>
          {data.groups.filter((g) => g.categories.length).map((g) => {
            const sum = (key) => g.categories.reduce((s, c) => s + c[key], 0);
            return (
              <section key={g.id}>
                <div className={`${COLS} border-b border-line bg-sunken py-2`}>
                  <h2 className="text-sm font-semibold">{g.name}</h2>
                  <span className="num hidden text-right text-sm text-muted md:block"><Money value={sum('assigned')} /></span>
                  <span className="num hidden text-right text-sm text-muted md:block"><Money value={sum('activity')} /></span>
                  <span className="num text-right text-sm font-medium text-muted"><Money value={sum('available')} /></span>
                </div>
                {g.categories.map((c) => (
                  <div key={c.id} className={`${COLS} border-b border-line py-2.5 last:border-b-0`}>
                    <span className="truncate text-sm font-medium">{c.name}{c.hidden && <span className="ml-2 text-xs text-muted">(hidden)</span>}</span>
                    <span className="text-right md:order-last"><Available value={c.available} /></span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted md:hidden">Assigned</span>
                      <AssignInput category={c.name} period={period.label} value={c.assigned} onError={setAssignError} />
                    </span>
                    <Link className="num text-right text-sm text-muted hover:underline"
                      to={`/transactions${qs({ category: c.name, from: period.start, to: period.end })}`}
                      title={`Show ${c.name} transactions in this period`}>
                      <span className="mr-1 text-xs md:hidden">Activity</span><Money value={c.activity} />
                    </Link>
                  </div>
                ))}
              </section>
            );
          })}
          <div className={`${COLS} border-t border-line py-2.5`}>
            <span className="text-sm font-semibold">Total</span>
            <span className="num hidden text-right text-sm font-semibold md:block"><Money value={data.totals.assigned} /></span>
            <span className="num hidden text-right text-sm font-semibold md:block"><Money value={data.totals.activity} /></span>
            <span className="num text-right text-sm font-semibold"><Money value={data.totals.available} /></span>
          </div>
        </div>
      )}
      <p className="text-xs text-muted">Unspent money in a category carries over to the next period; overspending carries over as a negative amount.</p>
    </div>
  );
}
