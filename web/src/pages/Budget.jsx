import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { periodByLabel, periodTitle, shiftLabel } from '../../../shared/periods.js';
import { api, qs } from '../api.js';
import { store, useApp, useData } from '../state.jsx';
import { ErrorNote, Field, Icon, Modal, Money, PeriodSwitcher, parseAmount, useAction } from '../ui.jsx';

const COLS = 'grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-3 md:grid-cols-[minmax(0,1fr)_8rem_8rem_8.5rem] md:px-4';
const FILTERS = [['all', 'All'], ['overspent', 'Overspent'], ['available', 'Money available'], ['hidden', 'Hidden']];

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
    <input className="input num text-right md:min-h-8 md:border-transparent md:bg-transparent md:hover:border-line md:focus:bg-surface"
      inputMode="decimal" placeholder="0.00" value={text} aria-label={`Assigned to ${category}`}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
  );
}

function Available({ value }) {
  const tone = value < -0.005 ? 'bg-neg-bg text-neg' : value > 0.005 ? 'bg-pos-bg text-pos' : 'bg-sunken text-muted';
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-semibold ${tone}`}><Money value={value} /></span>;
}

// Add or edit a category group or a category, right from the budget screen.
function CategoryDialog({ dialog, groups, onClose }) {
  const { bump } = useApp();
  const { mode, item } = dialog;
  const isCategory = mode === 'category' || mode === 'new-category';
  const isNew = mode.startsWith('new');
  const [name, setName] = useState(isNew ? '' : item.name);
  const [group, setGroup] = useState(isCategory ? dialog.group : '');

  const finish = () => { bump(); onClose(); };
  const [save, saving, saveError] = useAction(async (e) => {
    e.preventDefault();
    if (mode === 'new-group') await api('POST', '/category-groups', { name });
    else if (mode === 'new-category') await api('POST', '/categories', { name, group });
    else if (mode === 'group') await api('PATCH', `/category-groups/${item.id}`, { name });
    else await api('PATCH', `/categories/${item.id}`, { name, group });
    finish();
  });
  const [toggleHidden, hiding, hideError] = useAction(async () => {
    await api('PATCH', `/categories/${item.id}`, { hidden: !item.hidden });
    finish();
  });
  const [remove, removing, removeError] = useAction(async () => {
    if (!window.confirm(`Delete “${item.name}”?`)) return;
    await api('DELETE', isCategory ? `/categories/${item.id}` : `/category-groups/${item.id}`);
    finish();
  });

  const title = { 'new-group': 'New category group', 'new-category': 'New category', group: 'Edit category group', category: 'Edit category' }[mode];
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus
            placeholder={isCategory ? 'e.g. Groceries' : 'e.g. Bills'} />
        </Field>
        {isCategory && (
          <Field label="Group">
            <select className="input" value={group} onChange={(e) => setGroup(e.target.value)}>
              {groups.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
            </select>
          </Field>
        )}
        {mode === 'category' && (
          <p className="text-xs text-muted">Hide a category you no longer use; its history is kept. It can only be deleted if it has no transactions.</p>
        )}
        {mode === 'group' && <p className="text-xs text-muted">A group can only be deleted once it has no categories.</p>}
        <ErrorNote error={saveError || hideError || removeError} />
        <div className="flex flex-wrap gap-3">
          {!isNew && <button type="button" className="btn btn-danger" onClick={remove} disabled={removing}>Delete</button>}
          {mode === 'category' && <button type="button" className="btn" onClick={toggleHidden} disabled={hiding}>{item.hidden ? 'Show again' : 'Hide'}</button>}
          <button className="btn btn-primary flex-1" disabled={saving}>{isNew ? 'Add' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function Panel({ title, children }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Line({ label, value, strong }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 text-sm ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-muted'}>{label}</span>
      <Money value={value} />
    </div>
  );
}

function SidePanel({ data, onError }) {
  const { bump, budget } = useApp();
  const { period } = data;
  const categories = data.groups.flatMap((g) => g.categories).filter((c) => !c.hidden);
  const previous = periodByLabel(shiftLabel(period.label, -1), budget.cutoff_day);

  // Quick assign only fills categories that have nothing assigned yet.
  const empty = categories.filter((c) => Math.abs(c.assigned) < 0.005);
  const plans = [
    { key: 'assigned', label: 'Assigned last period', items: empty.filter((c) => c.last_assigned > 0).map((c) => [c.name, c.last_assigned]) },
    { key: 'spent', label: 'Spent last period', items: empty.filter((c) => c.last_activity < -0.005).map((c) => [c.name, -c.last_activity]) },
  ];
  const assigned = categories.filter((c) => Math.abs(c.assigned) >= 0.005);

  const [apply, busy] = useAction(async (items, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      for (const [category, amount] of items) {
        await api('PUT', '/budget/assign', { category, period: period.label, amount: Math.round(amount * 100) / 100 });
      }
      onError(null);
    } catch (err) {
      onError(err);
    }
    bump();
  });

  const action = 'flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg bg-sunken px-3 py-2 text-left text-sm font-medium text-accent hover:opacity-80 disabled:cursor-not-allowed disabled:text-muted';
  return (
    <aside className="space-y-4">
      <Panel title="Period summary">
        <Line label="Left over from last period" value={data.left_over} />
        <Line label="Assigned this period" value={data.totals.assigned} />
        <Line label="Activity" value={data.totals.activity} />
        <div className="mt-1 border-t border-line pt-1"><Line label="Available" value={data.totals.available} strong /></div>
      </Panel>

      <Panel title="Quick assign">
        <p className="mb-3 text-xs text-muted">Fills categories that have nothing assigned yet, using {periodTitle(previous)}.</p>
        <div className="space-y-2">
          {plans.map((p) => (
            <button key={p.key} type="button" className={action} disabled={busy || !p.items.length} onClick={() => apply(p.items)}>
              <span>{p.label}</span><Money value={p.items.reduce((s, [, v]) => s + v, 0)} />
            </button>
          ))}
          <button type="button" className={action} disabled={busy || !assigned.length}
            onClick={() => apply(assigned.map((c) => [c.name, 0]), 'Set every assigned amount in this period back to zero?')}>
            <span>Reset assigned amounts</span><Money value={0} />
          </button>
        </div>
      </Panel>

      <Panel title="Assigned in future periods">
        <Line label="After this period" value={data.assigned_future} />
      </Panel>
    </aside>
  );
}

export default function Budget() {
  const { budget } = useApp();
  const [label, setLabel] = useState(null);
  const [filter, setFilter] = useState('all');
  const [dialog, setDialog] = useState(null);
  const [assignError, setAssignError] = useState(null);
  const collapseKey = `knab-collapsed-${budget.id}`;
  const [collapsed, setCollapsed] = useState(() => new Set(JSON.parse(store.get(collapseKey) || '[]')));
  const { data, error } = useData(`/budget${qs({ period: label })}`);
  useEffect(() => { setLabel(null); }, [budget.id, budget.cutoff_day]);
  useEffect(() => { setCollapsed(new Set(JSON.parse(store.get(collapseKey) || '[]'))); }, [collapseKey]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <p className="text-muted">Loading…</p>;

  const toggle = (id) => {
    const next = new Set(collapsed);
    if (!next.delete(id)) next.add(id);
    setCollapsed(next);
    store.set(collapseKey, JSON.stringify([...next]));
  };

  const { period, ready_to_assign: rta } = data;
  const rtaTone = rta < -0.005 ? 'bg-neg-bg text-neg' : rta > 0.005 ? 'bg-pos-bg text-pos' : 'bg-sunken text-muted';
  const rtaText = rta < -0.005 ? 'You assigned more than you have' : rta > 0.005 ? 'Ready to assign' : 'All money assigned';

  const nonZero = (c) => Math.abs(c.assigned) >= 0.005 || Math.abs(c.activity) >= 0.005 || Math.abs(c.available) >= 0.005;
  const matches = (c) => {
    if (filter === 'hidden') return c.hidden;
    if (c.hidden && !nonZero(c)) return false;
    if (filter === 'overspent') return c.available < -0.005;
    if (filter === 'available') return c.available > 0.005;
    return true;
  };
  const all = data.groups.flatMap((g) => g.categories);
  const overspent = all.filter((c) => c.available < -0.005 && (!c.hidden || nonZero(c))).length;
  const groups = data.groups
    .map((g) => ({ ...g, shown: g.categories.filter(matches) }))
    .filter((g) => filter === 'all' || g.shown.length);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <PeriodSwitcher label={period.label} onChange={setLabel} currentLabel={data.current_period} />
          <div className={`flex items-center justify-between gap-5 rounded-xl px-4 py-2 ${rtaTone}`}>
            <span className="num text-xl font-semibold"><Money value={rta} /></span>
            <span className="text-sm font-medium">{rtaText}</span>
          </div>
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label="Filter categories">
          {FILTERS.map(([value, text]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
              className={`chip ${filter === value ? 'chip-on' : ''}`}>
              {value === 'overspent' && overspent > 0 ? `${overspent} overspent` : text}
            </button>
          ))}
        </div>

        <ErrorNote error={assignError} />

        <div className="card overflow-hidden">
          <div className="flex items-center gap-4 border-b border-line px-3 py-1 md:px-4">
            <button type="button" className="link-btn" onClick={() => setDialog({ mode: 'new-group' })}><Icon name="plus" size={16} /> Category group</button>
            {collapsed.size > 0 && <button type="button" className="link-btn text-muted" onClick={() => { setCollapsed(new Set()); store.set(collapseKey, '[]'); }}>Expand all</button>}
          </div>
          <div className={`${COLS} hidden border-b border-line py-2 md:grid`}>
            <span className="section-title pl-7">Category</span>
            <span className="section-title pr-3 text-right">Assigned</span>
            <span className="section-title text-right">Activity</span>
            <span className="section-title text-right">Available</span>
          </div>

          {!groups.length && (
            <p className="px-4 py-10 text-center text-sm text-muted">
              {filter === 'all' ? 'No categories yet. Start with “+ Category group”.' : 'No categories match this filter.'}
            </p>
          )}

          {groups.map((g) => {
            const sum = (key) => g.shown.reduce((s, c) => s + c[key], 0);
            const isCollapsed = collapsed.has(g.id);
            return (
              <section key={g.id}>
                <div className={`${COLS} border-b border-line bg-sunken py-1.5`}>
                  <div className="flex min-w-0 items-center gap-1">
                    <button type="button" className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:text-ink md:size-6"
                      onClick={() => toggle(g.id)} aria-expanded={!isCollapsed} aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${g.name}`}>
                      <Icon name={isCollapsed ? 'right' : 'down'} size={16} />
                    </button>
                    <button type="button" className="min-w-0 cursor-pointer truncate text-sm font-semibold hover:underline"
                      onClick={() => setDialog({ mode: 'group', item: g })} title="Rename or delete this group">{g.name}</button>
                    <button type="button" className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded text-accent hover:bg-surface md:size-6"
                      onClick={() => setDialog({ mode: 'new-category', group: g.name })} aria-label={`Add a category to ${g.name}`} title="Add category">
                      <Icon name="plus" size={16} />
                    </button>
                  </div>
                  <span className="num hidden pr-3 text-right text-sm text-muted md:block"><Money value={sum('assigned')} /></span>
                  <span className="num hidden text-right text-sm text-muted md:block"><Money value={sum('activity')} /></span>
                  <span className="num text-right text-sm font-medium text-muted"><Money value={sum('available')} /></span>
                </div>
                {!isCollapsed && !g.shown.length && (
                  <p className="border-b border-line px-4 py-2 pl-10 text-sm text-muted">No categories in this group yet.</p>
                )}
                {!isCollapsed && g.shown.map((c) => (
                  <div key={c.id} className={`${COLS} border-b border-line py-2 md:py-1`}>
                    <button type="button" onClick={() => setDialog({ mode: 'category', item: c, group: g.name })} title="Rename, move, hide or delete"
                      className="min-w-0 cursor-pointer truncate text-left text-sm hover:underline md:pl-7">
                      {c.name}{c.hidden && <span className="ml-2 text-xs text-muted">(hidden)</span>}
                    </button>
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

          <div className={`${COLS} py-2.5`}>
            <span className="text-sm font-semibold md:pl-7">Total</span>
            <span className="num hidden pr-3 text-right text-sm font-semibold md:block"><Money value={data.totals.assigned} /></span>
            <span className="num hidden text-right text-sm font-semibold md:block"><Money value={data.totals.activity} /></span>
            <span className="num text-right text-sm font-semibold"><Money value={data.totals.available} /></span>
          </div>
        </div>
        <p className="text-xs text-muted">Unspent money in a category carries over to the next period; overspending carries over as a negative amount.</p>
      </div>

      <SidePanel data={data} onError={setAssignError} />
      {dialog && <CategoryDialog dialog={dialog} groups={data.groups} onClose={() => setDialog(null)} />}
    </div>
  );
}
