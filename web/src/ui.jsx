import { useCallback, useEffect, useState } from 'react';
import { periodByLabel, periodTitle, shiftLabel } from '../../shared/periods.js';
import { useApp } from './state.jsx';

const ICONS = {
  budget: 'M3 7h18v12H3zM3 7l9 6 9-6',
  accounts: 'M3 10l9-6 9 6M5 10v9M19 10v9M9 10v9M15 10v9M3 19h18',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4M14 4v4M6 10v4M12 16v4',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  plus: 'M12 5v14M5 12h14',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  down: 'M6 9l6 6 6-6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
};

export function Icon({ name, size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="flex max-h-[94dvh] w-full flex-col rounded-t-2xl bg-surface shadow-xl md:max-w-lg md:rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="btn btn-ghost -mr-2 px-2" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <p role="alert" className="rounded-lg bg-neg-bg px-3 py-2 text-sm text-neg">{error.message || String(error)}</p>;
}

// Wraps an async handler with busy and error state.
export function useAction(fn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (...args) => {
    setBusy(true);
    setError(null);
    try {
      return await fn(...args);
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [fn]);
  return [run, busy, error, setError];
}

export function parseAmount(text) {
  const cleaned = String(text).trim().replace(/[^\d.,-]/g, '');
  if (!cleaned) return NaN;
  // "12,50" -> 12.50; "1,234.50" -> 1234.50
  const normalised = cleaned.includes('.') ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  return Number(normalised);
}

export function Money({ value, signed = false, className = '' }) {
  const { money } = useApp();
  const tone = !signed || Math.abs(value) < 0.005 ? '' : value > 0 ? 'text-pos' : 'text-neg';
  return <span className={`num ${tone} ${className}`}>{money(value)}</span>;
}

export function PeriodSwitcher({ label, onChange, currentLabel }) {
  const { budget } = useApp();
  const period = periodByLabel(label, budget.cutoff_day);
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="btn px-2" onClick={() => onChange(shiftLabel(label, -1))} aria-label="Previous period"><Icon name="left" /></button>
      <div className="min-w-0 flex-1 text-center md:flex-none md:px-3">
        <div className="num truncate text-sm font-semibold">{periodTitle(period)}</div>
        {currentLabel && label !== currentLabel && (
          <button type="button" className="cursor-pointer text-xs text-accent underline" onClick={() => onChange(currentLabel)}>Back to current</button>
        )}
      </div>
      <button type="button" className="btn px-2" onClick={() => onChange(shiftLabel(label, 1))} aria-label="Next period"><Icon name="right" /></button>
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="card px-4 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}
