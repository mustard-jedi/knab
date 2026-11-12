// Resizable grid columns whose widths are remembered in this browser.
//
// `columns` is [{ key, width }] in display order.
//   flex: true   takes whatever space is left (never less than `width`); no handle
//   fixed: true  always `width`; no handle
//   grow: n      shares spare space (n parts, at least `width`) until the user
//                drags it, after which it keeps the width they chose
import { useCallback, useEffect, useRef, useState } from 'react';
import { store } from './state.jsx';

const MIN = 48;
const MAX = 640;
const GAP = 12; // gap-3
const clamp = (n) => Math.min(MAX, Math.max(MIN, Math.round(n)));

function load(storageKey) {
  try {
    const saved = JSON.parse(store.get(storageKey) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

export function useColumns(storageKey, columns) {
  const [saved, setSaved] = useState(() => load(storageKey));
  const latest = useRef(saved);
  latest.current = saved;

  const sized = (c) => !c.flex && !c.fixed && Number.isFinite(saved[c.key]);
  const widthOf = (c) => (sized(c) ? clamp(saved[c.key]) : c.width);
  const template = columns.map((c) => {
    if (c.flex || (c.grow && !sized(c))) return `minmax(${c.width}px, ${c.grow || 1}fr)`;
    return `${widthOf(c)}px`;
  }).join(' ');
  const minWidth = columns.reduce((sum, c) => sum + widthOf(c), 0) + GAP * (columns.length - 1);

  const set = useCallback((key, width, persist) => {
    const next = { ...latest.current };
    if (width === null) delete next[key];
    else next[key] = clamp(width);
    latest.current = next;
    setSaved(next);
    if (persist) store.set(storageKey, JSON.stringify(next));
  }, [storageKey]);

  const customised = columns.some((c) => Number.isFinite(saved[c.key]));
  const reset = useCallback(() => {
    latest.current = {};
    setSaved({});
    store.set(storageKey, '{}');
  }, [storageKey]);

  return { template, minWidth, widthOf, set, reset, customised };
}

// Drag handle on the right edge of a header cell. Drag to resize, double-click
// to go back to the default width, or use the arrow keys when it has focus.
export function ResizeHandle({ column, label, cols }) {
  const drag = useRef(null);
  const width = cols.widthOf(column);
  // A column that is still sharing spare space has no stored width: measure it.
  const measured = (el) => Math.round(el.parentElement.getBoundingClientRect().width);
  useEffect(() => () => { document.body.style.cursor = ''; }, []);

  const onPointerDown = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width: measured(e.currentTarget) };
    document.body.style.cursor = 'col-resize';
  };
  const onPointerMove = (e) => {
    if (drag.current) cols.set(column.key, drag.current.width + e.clientX - drag.current.x, false);
  };
  const onPointerUp = (e) => {
    if (!drag.current) return;
    cols.set(column.key, drag.current.width + e.clientX - drag.current.x, true);
    drag.current = null;
    document.body.style.cursor = '';
  };
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    cols.set(column.key, measured(e.currentTarget) + (e.key === 'ArrowRight' ? 16 : -16), true);
  };
  return (
    <span role="separator" aria-orientation="vertical" tabIndex={0} aria-label={`Resize ${label} column`}
      aria-valuenow={width} aria-valuemin={MIN} aria-valuemax={MAX} title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onDoubleClick={() => cols.set(column.key, null, true)} onKeyDown={onKeyDown}
      className="group absolute -top-2 -right-3 -bottom-2 z-10 flex w-3 cursor-col-resize touch-none justify-center">
      <span className="h-full w-px bg-line group-hover:w-0.5 group-hover:bg-accent group-focus-visible:w-0.5 group-focus-visible:bg-accent" />
    </span>
  );
}
