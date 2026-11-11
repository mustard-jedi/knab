// Hand-written SVG charts for the Reports page. Colours come from the theme
// variables, so they follow light and dark mode.
import { useEffect, useRef, useState } from 'react';
import { useApp } from './state.jsx';
import { Money } from './ui.jsx';

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
export const OTHER = 'var(--other)';

const H = 260;
const PAD = { top: 12, right: 24, bottom: 24, left: 56 };

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

function Frame({ width, scale, labels, format, children }) {
  const compact = useCompact();
  const fmt = format || compact;
  const y = (v) => PAD.top + (1 - (v - scale.lo) / (scale.hi - scale.lo)) * (H - PAD.top - PAD.bottom);
  const every = Math.ceil(labels.length / Math.max(1, Math.floor((width - PAD.left) / 56)));
  return (
    <>
      {scale.ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--muted)' : 'var(--grid)'} strokeWidth="1" />
          <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{fmt(t)}</text>
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
  const left = Math.min(Math.max(x, 100), Math.max(100, width - 100));
  return (
    <div className="pointer-events-none absolute top-0 z-10 w-48 -translate-x-1/2 rounded-lg border border-line bg-surface p-2 text-xs shadow-lg" style={{ left }}>
      {children}
    </div>
  );
}

export function Swatch({ color, line = false }) {
  return <span className={`inline-block shrink-0 ${line ? 'h-0.5 w-3' : 'size-2.5 rounded-sm'}`} style={{ background: color }} />;
}

function Row({ color, line, label, children }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">{color && <Swatch color={color} line={line} />}<span className="truncate">{label}</span></span>
      {children}
    </div>
  );
}

// Bar with only its data end rounded, anchored to the baseline.
function bar(x, w, y0, y1) {
  const r = Math.min(4, w / 2, Math.abs(y0 - y1));
  return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
}

function Legend({ items }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map(([color, text, line]) => <span key={text} className="flex items-center gap-1.5"><Swatch color={color} line={line} /> {text}</span>)}
    </div>
  );
}

// Part-to-whole ring. `segments` is [{ name, value, color }], already limited
// to a handful of parts. Hovering or tapping a part shows it in the centre.
export function Donut({ segments, total, label }) {
  const [hover, setHover] = useState(null);
  const R = 78;
  const C = 2 * Math.PI * R;
  const sum = segments.reduce((s, x) => s + x.value, 0) || 1;
  const gap = segments.length > 1 ? 2 : 0;
  let offset = 0;
  const arcs = segments.map((s) => {
    const len = (s.value / sum) * C;
    const arc = { ...s, len, offset };
    offset += len;
    return arc;
  });
  const active = hover !== null ? segments[hover] : null;
  return (
    <div className="relative mx-auto w-full max-w-72" onMouseLeave={() => setHover(null)}>
      <svg viewBox="0 0 200 200" className="block w-full" role="img" aria-label={`${label} split into ${segments.length} parts`}>
        <g transform="rotate(-90 100 100)">
          {arcs.map((a, i) => (
            <circle key={a.name} cx="100" cy="100" r={R} fill="none" stroke={a.color} strokeWidth={hover === i ? 32 : 28}
              strokeDasharray={`${Math.max(0.5, a.len - gap)} ${C}`} strokeDashoffset={-a.offset}
              opacity={hover === null || hover === i ? 1 : 0.45} className="cursor-pointer transition-all"
              onMouseEnter={() => setHover(i)} onClick={() => setHover(hover === i ? null : i)} />
          ))}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-14 text-center">
        <span className="line-clamp-2 text-xs text-muted">{active ? active.name : label}</span>
        <Money value={active ? active.value : total} className="text-base font-semibold md:text-lg" />
        {active && <span className="num text-xs text-muted">{((active.value / sum) * 100).toFixed(1)}%</span>}
      </div>
    </div>
  );
}

// One bar per period with a dashed line at the average.
export function SpendingChart({ points, average }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const scale = axis(Math.min(0, ...points.map((p) => p.total)), Math.max(1, ...points.map((p) => p.total)));
  const band = (width - PAD.left - PAD.right) / points.length;
  const barW = Math.max(4, Math.min(72, band * 0.6));
  const centre = (i) => PAD.left + band * (i + 0.5);
  const active = hover !== null ? points[hover] : null;
  return (
    <div>
      <Legend items={[['var(--series-1)', 'Spending'], ['var(--muted)', 'Average', true]]} />
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label="Spending per period">
            <Frame width={width} scale={scale} labels={points.map((p, i) => ({ x: centre(i), text: p.tick }))}>
              {(y) => (
                <>
                  {points.map((p, i) => (
                    <g key={p.name} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
                      <rect x={PAD.left + band * i} y={PAD.top} width={band} height={H - PAD.top - PAD.bottom} fill={hover === i ? 'var(--sunken)' : 'transparent'} />
                      {p.total !== 0 && <path d={bar(centre(i) - barW / 2, barW, y(0), y(p.total))} fill="var(--series-1)" />}
                    </g>
                  ))}
                  {points.length > 1 && <line x1={PAD.left} x2={width - PAD.right} y1={y(average)} y2={y(average)} stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 4" pointerEvents="none" />}
                </>
              )}
            </Frame>
          </svg>
        )}
        {active && (
          <Tooltip x={centre(hover)} width={width}>
            <div className="mb-1 font-semibold">{active.name}</div>
            <Row label="Spending"><Money value={active.total} className="font-semibold" /></Row>
            {active.top.map((t) => <div key={t.name} className="text-muted"><Row label={t.name}><Money value={t.value} /></Row></div>)}
          </Tooltip>
        )}
      </div>
    </div>
  );
}

// Assets and debts as bars, net worth as a line, all on one money axis.
export function WorthChart({ points }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const scale = axis(
    Math.min(0, ...points.map((p) => p.net_worth)),
    Math.max(1, ...points.flatMap((p) => [p.assets, -p.debts])),
  );
  const band = (width - PAD.left - PAD.right) / points.length;
  const barW = Math.max(3, Math.min(20, (band - 8) / 2));
  const centre = (i) => PAD.left + band * (i + 0.5);
  const active = hover !== null ? points[hover] : null;
  return (
    <div>
      <Legend items={[['var(--series-1)', 'Assets'], ['var(--series-2)', 'Debts'], ['var(--ink)', 'Net worth', true]]} />
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label="Assets, debts and net worth at the end of each period">
            <Frame width={width} scale={scale} labels={points.map((p, i) => ({ x: centre(i), text: p.tick }))}>
              {(y) => (
                <>
                  {points.map((p, i) => (
                    <g key={p.name} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
                      <rect x={PAD.left + band * i} y={PAD.top} width={band} height={H - PAD.top - PAD.bottom} fill={hover === i ? 'var(--sunken)' : 'transparent'} />
                      {p.debts < 0 && <path d={bar(centre(i) - barW - 1, barW, y(0), y(-p.debts))} fill="var(--series-2)" />}
                      {p.assets > 0 && <path d={bar(centre(i) + 1, barW, y(0), y(p.assets))} fill="var(--series-1)" />}
                    </g>
                  ))}
                  <g pointerEvents="none">
                    <polyline points={points.map((p, i) => `${centre(i)},${y(p.net_worth)}`).join(' ')} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                    {points.map((p, i) => <circle key={p.name} cx={centre(i)} cy={y(p.net_worth)} r={hover === i ? 5 : 4} fill="var(--surface)" stroke="var(--ink)" strokeWidth="2" />)}
                  </g>
                </>
              )}
            </Frame>
          </svg>
        )}
        {active && (
          <Tooltip x={centre(hover)} width={width}>
            <div className="mb-1 font-semibold">{active.name}</div>
            <Row color="var(--ink)" line label="Net worth"><Money value={active.net_worth} className="font-semibold" /></Row>
            <Row color="var(--series-1)" label="Assets"><Money value={active.assets} /></Row>
            <Row color="var(--series-2)" label="Debts"><Money value={active.debts} /></Row>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

// Single-series area: age of money in days at the end of each period.
export function AgeChart({ points }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const known = points.map((p, i) => ({ ...p, i })).filter((p) => p.age !== null);
  const scale = axis(0, Math.max(10, ...known.map((p) => p.age)));
  const step = points.length > 1 ? (width - PAD.left - PAD.right - 16) / (points.length - 1) : 0;
  const x = (i) => PAD.left + 8 + step * i;
  const active = hover !== null ? points[hover] : null;
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = step ? Math.round((e.clientX - rect.left - PAD.left - 8) / step) : 0;
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };
  return (
    <div ref={ref} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onMove}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Age of money at the end of each period">
          <Frame width={width} scale={scale} format={(d) => `${d} d`} labels={points.map((p, i) => ({ x: x(i), text: p.tick }))}>
            {(y) => known.length > 0 && (
              <>
                <path d={`M${x(known[0].i)},${y(0)} ${known.map((p) => `L${x(p.i)},${y(p.age)}`).join(' ')} L${x(known[known.length - 1].i)},${y(0)} Z`} fill="var(--series-1)" opacity="0.18" />
                <polyline points={known.map((p) => `${x(p.i)},${y(p.age)}`).join(' ')} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {known.map((p) => <circle key={p.name} cx={x(p.i)} cy={y(p.age)} r={hover === p.i ? 5 : 4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth="2" />)}
                {active && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />}
              </>
            )}
          </Frame>
        </svg>
      )}
      {active && (
        <Tooltip x={x(hover)} width={width}>
          <div className="mb-1 font-semibold">{active.name}</div>
          <Row label="Age of money"><span className="num font-semibold">{active.age === null ? 'No spending yet' : `${active.age} days`}</span></Row>
        </Tooltip>
      )}
    </div>
  );
}
