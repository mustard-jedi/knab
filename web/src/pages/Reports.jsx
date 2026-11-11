import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { periodByLabel, periodFor, periodTitle, shortDate, todayStr } from '../../../shared/periods.js';
import { qs } from '../api.js';
import { useApp, useData } from '../state.jsx';
import { Empty, ErrorNote, Money, PageHeader, PeriodSwitcher } from '../ui.jsx';

const TABS = [['spending', 'Spending'], ['flow', 'Income vs spending'], ['worth', 'Net worth']];

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // Measure straight away; the observer only handles later resizes.
    setWidth(Math.floor(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// Round axis steps: 1, 2, 2.5 or 5 times a power of ten.
function axis(min, max, target = 4) {
  if (min === max) max = min + 1;
  const raw = (max - min) / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) * pow;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo, hi, ticks };
}

function useCompact() {
  const { budget } = useApp();
  try {
    const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: budget.currency, notation: 'compact', maximumFractionDigits: 1 });
    return (n) => fmt.format(n);
  } catch {
    return (n) => String(n);
  }
}

const H = 240;
const PAD = { top: 12, right: 24, bottom: 24, left: 52 };

function Frame({ width, scale, labels, children }) {
  const compact = useCompact();
  const y = (v) => PAD.top + (1 - (v - scale.lo) / (scale.hi - scale.lo)) * (H - PAD.top - PAD.bottom);
  const every = Math.ceil(labels.length / Math.max(1, Math.floor((width - PAD.left) / 56)));
  return (
    <>
      {scale.ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--muted)' : 'var(--grid)'} strokeWidth="1" />
          <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{compact(t)}</text>
        </g>
      ))}
      {labels.map((l, i) => (i % every === 0 ? (
        <text key={l.x + l.text} x={l.x} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">{l.text}</text>
      ) : null))}
      {children(y)}
    </>
  );
}

function Tooltip({ x, width, children }) {
  const left = Math.min(Math.max(x, 90), Math.max(90, width - 90));
  return (
    <div className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-lg border border-line bg-surface p-2 text-xs shadow-lg" style={{ left }}>
      {children}
    </div>
  );
}

function Swatch({ color }) {
  return <span className="inline-block size-2.5 rounded-sm" style={{ background: color }} />;
}

// Bar with only its data end rounded, anchored to the baseline.
function bar(x, w, y0, y1) {
  const r = Math.min(4, w / 2, Math.abs(y0 - y1));
  return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
}

function FlowChart({ periods }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const scale = axis(0, Math.max(1, ...periods.flatMap((p) => [p.income, p.spending])));
  const band = (width - PAD.left - PAD.right) / periods.length;
  const barW = Math.max(3, Math.min(18, (band - 8) / 2));
  const centre = (i) => PAD.left + band * (i + 0.5);
  const active = hover !== null ? periods[hover] : null;
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><Swatch color="var(--series-1)" /> Income</span>
        <span className="flex items-center gap-1.5"><Swatch color="var(--series-2)" /> Spending</span>
      </div>
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label="Income and spending per period">
            <Frame width={width} scale={scale} labels={periods.map((p, i) => ({ x: centre(i), text: shortDate(p.start) }))}>
              {(y) => periods.map((p, i) => (
                <g key={p.label} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
                  <rect x={PAD.left + band * i} y={PAD.top} width={band} height={H - PAD.top - PAD.bottom} fill={hover === i ? 'var(--sunken)' : 'transparent'} />
                  {p.income > 0 && <path d={bar(centre(i) - barW - 1, barW, y(0), y(p.income))} fill="var(--series-1)" />}
                  {p.spending > 0 && <path d={bar(centre(i) + 1, barW, y(0), y(p.spending))} fill="var(--series-2)" />}
                </g>
              ))}
            </Frame>
          </svg>
        )}
        {active && (
          <Tooltip x={centre(hover)} width={width}>
            <div className="mb-1 font-semibold">{periodTitle(active)}</div>
            <div className="flex justify-between gap-2"><span className="flex items-center gap-1.5"><Swatch color="var(--series-1)" /> Income</span><Money value={active.income} /></div>
            <div className="flex justify-between gap-2"><span className="flex items-center gap-1.5"><Swatch color="var(--series-2)" /> Spending</span><Money value={active.spending} /></div>
            <div className="mt-1 flex justify-between gap-2 border-t border-line pt-1"><span>Left over</span><Money value={active.income - active.spending} signed /></div>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function WorthChart({ periods }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const values = periods.map((p) => p.net_worth);
  const scale = axis(Math.min(0, ...values), Math.max(0, ...values));
  const step = periods.length > 1 ? (width - PAD.left - PAD.right - 16) / (periods.length - 1) : 0;
  const x = (i) => PAD.left + 8 + step * i;
  const active = hover !== null ? periods[hover] : null;
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = step ? Math.round((e.clientX - rect.left - PAD.left - 8) / step) : 0;
    setHover(Math.min(periods.length - 1, Math.max(0, i)));
  };
  return (
    <div ref={ref} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onMove}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Net worth at the end of each period">
          <Frame width={width} scale={scale} labels={periods.map((p, i) => ({ x: x(i), text: shortDate(p.end) }))}>
            {(y) => (
              <>
                {active && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />}
                <polyline points={periods.map((p, i) => `${x(i)},${y(p.net_worth)}`).join(' ')} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {(periods.length === 1 || active) && (
                  <circle cx={x(hover ?? 0)} cy={y((active || periods[0]).net_worth)} r="4.5" fill="var(--series-1)" stroke="var(--surface)" strokeWidth="2" />
                )}
              </>
            )}
          </Frame>
        </svg>
      )}
      {active && (
        <Tooltip x={x(hover)} width={width}>
          <div className="mb-1 font-semibold">{shortDate(active.end, true)}</div>
          <div className="flex justify-between gap-2"><span>Net worth</span><Money value={active.net_worth} className="font-semibold" /></div>
          <div className="flex justify-between gap-2 text-muted"><span>Assets</span><Money value={active.assets} /></div>
          <div className="flex justify-between gap-2 text-muted"><span>Debts</span><Money value={active.debts} /></div>
        </Tooltip>
      )}
    </div>
  );
}

function Spending() {
  const { budget } = useApp();
  const current = periodFor(todayStr(), budget.cutoff_day);
  const [label, setLabel] = useState(current.label);
  const [account, setAccount] = useState('');
  const period = periodByLabel(label, budget.cutoff_day);
  const accounts = useData('/accounts').data;
  const { data, error } = useData(`/reports/spending${qs({ from: period.start, to: period.end, account })}`);
  const max = Math.max(0, ...(data?.categories || []).map((c) => c.spent));
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <PeriodSwitcher label={label} onChange={setLabel} currentLabel={current.label} />
        <select className="input md:w-48" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account">
          <option value="">All accounts</option>
          {(accounts || []).map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
      </div>
      <ErrorNote error={error} />
      {data && !data.categories.length && <Empty title="No spending in this period" />}
      {data && data.categories.length > 0 && (
        <div className="card p-4">
          <div className="mb-4 flex items-baseline justify-between">
            <span className="text-sm text-muted">Total spent</span>
            <Money value={data.total} className="text-2xl font-semibold" />
          </div>
          <ul className="space-y-3">
            {data.categories.map((c) => (
              <li key={c.category}>
                <Link to={`/transactions${qs({ category: c.category, from: period.start, to: period.end, account })}`} className="group block">
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate group-hover:underline">{c.category} <span className="text-xs text-muted">{c.group}</span></span>
                    <span className="shrink-0"><Money value={c.spent} className="font-medium" />
                      <span className="num ml-2 inline-block w-10 text-right text-xs text-muted">{data.total > 0 ? `${Math.round((c.spent / data.total) * 100)}%` : ''}</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-r bg-sunken">
                    {c.spent > 0 && <div className="h-2 rounded-r bg-series-1" style={{ width: `${Math.max(1, (c.spent / max) * 100)}%` }} />}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Trend({ kind }) {
  const [count, setCount] = useState(12);
  const { data, error } = useData(`/reports/trend?count=${count}`);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <p className="text-muted">Loading…</p>;
  const periods = data.periods;
  const rows = [...periods].reverse();
  return (
    <div className="space-y-4">
      <select className="input md:w-48" value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="How many periods">
        {[6, 12, 24].map((n) => <option key={n} value={n}>Last {n} periods</option>)}
      </select>
      <div className="card p-4">{kind === 'flow' ? <FlowChart periods={periods} /> : <WorthChart periods={periods} />}</div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="section-title px-4 py-2">Period</th>
              {(kind === 'flow' ? ['Income', 'Spending', 'Left over'] : ['Assets', 'Debts', 'Net worth']).map((h) => <th key={h} className="section-title px-4 py-2 text-right">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((p) => (
              <tr key={p.label}>
                <td className="num px-4 py-2 whitespace-nowrap">{periodTitle(p)}</td>
                {kind === 'flow' ? (
                  <>
                    <td className="px-4 py-2 text-right"><Money value={p.income} /></td>
                    <td className="px-4 py-2 text-right"><Money value={p.spending} /></td>
                    <td className="px-4 py-2 text-right"><Money value={p.income - p.spending} signed /></td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2 text-right"><Money value={p.assets} /></td>
                    <td className="px-4 py-2 text-right"><Money value={p.debts} /></td>
                    <td className="px-4 py-2 text-right"><Money value={p.net_worth} signed className="font-medium" /></td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('spending');
  return (
    <div className="max-w-5xl">
      <PageHeader title="Reports" />
      <div className="mb-4 grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-sunken p-1 md:inline-grid" role="tablist">
        {TABS.map(([value, text]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
            className={`min-h-10 cursor-pointer rounded-md px-3 text-sm font-medium md:min-h-8 ${tab === value ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>
            {text}
          </button>
        ))}
      </div>
      {tab === 'spending' ? <Spending /> : <Trend kind={tab} key={tab} />}
    </div>
  );
}
