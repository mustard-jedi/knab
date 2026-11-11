// Coloured flags: the pill shown on transactions, the picker in the
// transaction form, and the dialog for adding, renaming and removing flags.
import { useState } from 'react';
import { FLAG_COLORS } from '../../shared/flags.js';
import { api } from './api.js';
import { useApp, useData } from './state.jsx';
import { ErrorNote, Icon, Modal, useAction } from './ui.jsx';

const hex = (color) => FLAG_COLORS[color] || FLAG_COLORS.gray;
const tint = (color) => `color-mix(in srgb, ${hex(color)} 22%, transparent)`;

export function FlagMark({ color, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0" aria-hidden="true">
      <path d="M5 22V3" stroke={hex(color)} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M5 4h14l-3 4.5 3 4.5H5z" fill={hex(color)} />
    </svg>
  );
}

export function FlagPill({ name, color, className = '' }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${className}`} style={{ background: tint(color) }}>
      <FlagMark color={color} size={12} /><span className="truncate">{name}</span>
    </span>
  );
}

// value is a flag name, or '' for no flag.
export function FlagPicker({ value, onChange, onManage }) {
  const flags = useData('/flags').data || [];
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="label mb-0">Flag</span>
        <button type="button" className="cursor-pointer text-xs font-medium text-accent hover:underline" onClick={onManage}>Edit flags</button>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Flag">
        <button type="button" role="radio" aria-checked={!value} onClick={() => onChange('')}
          className={`min-h-9 cursor-pointer rounded-full border px-3 text-xs font-medium md:min-h-7 ${!value ? 'border-ink text-ink' : 'border-line text-muted'}`}>
          None
        </button>
        {flags.map((f) => {
          const on = f.name.toLowerCase() === value.toLowerCase();
          return (
            <button key={f.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(on ? '' : f.name)}
              className={`inline-flex min-h-9 max-w-40 cursor-pointer items-center gap-1 rounded-full border px-3 text-xs font-medium md:min-h-7 ${on ? 'border-ink' : 'border-transparent'}`}
              style={{ background: tint(f.color) }}>
              <FlagMark color={f.color} size={12} /><span className="truncate">{f.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Palette({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
      {Object.keys(FLAG_COLORS).map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} title={c} onClick={() => onChange(c)}
          className={`size-8 cursor-pointer rounded-full border-2 md:size-6 ${value === c ? 'border-ink' : 'border-transparent'}`}
          style={{ background: hex(c) }} />
      ))}
    </div>
  );
}

function FlagRow({ flag }) {
  const { bump } = useApp();
  const [name, setName] = useState(flag.name);
  const [picking, setPicking] = useState(false);
  const [patch, , error] = useAction(async (changes) => {
    await api('PATCH', `/flags/${flag.id}`, changes);
    bump();
  });
  const [remove, removing, removeError] = useAction(async () => {
    const used = flag.count ? ` ${flag.count} transaction${flag.count === 1 ? '' : 's'} will lose this flag.` : '';
    if (!window.confirm(`Remove the flag "${flag.name}"?${used}`)) return;
    await api('DELETE', `/flags/${flag.id}`);
    bump();
  });
  const rename = () => {
    const next = name.trim();
    if (!next) setName(flag.name);
    else if (next !== flag.name) patch({ name: next });
  };
  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setPicking((p) => !p)} aria-label={`Colour of ${flag.name}: ${flag.color}. Change`} aria-expanded={picking}
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line md:size-9">
          <FlagMark color={flag.color} size={18} />
        </button>
        <input className="input" value={name} maxLength={40} aria-label="Flag name" onChange={(e) => setName(e.target.value)} onBlur={rename}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
        <span className="num w-10 shrink-0 text-right text-xs text-muted" title="Transactions using this flag">{flag.count}</span>
        <button type="button" className="btn btn-ghost shrink-0 px-2 text-neg" onClick={remove} disabled={removing} aria-label={`Remove ${flag.name}`}><Icon name="close" size={18} /></button>
      </div>
      {picking && <div className="mt-2 pl-1"><Palette value={flag.color} onChange={(color) => { setPicking(false); if (color !== flag.color) patch({ color }); }} /></div>}
      <div className="mt-1"><ErrorNote error={error || removeError} /></div>
    </li>
  );
}

export function FlagManager({ onClose }) {
  const { bump } = useApp();
  const { data: flags, error } = useData('/flags');
  const [name, setName] = useState('');
  const [color, setColor] = useState(null);
  // Suggest a colour no flag uses yet.
  const suggested = Object.keys(FLAG_COLORS).find((c) => !(flags || []).some((f) => f.color === c)) || 'gray';
  const [add, adding, addError] = useAction(async (e) => {
    e.preventDefault();
    await api('POST', '/flags', { name: name.trim(), color: color || suggested });
    setName('');
    setColor(null);
    bump();
  });
  return (
    <Modal title="Flags" onClose={onClose}>
      <p className="mb-2 text-sm text-muted">Add as many flags as you need, rename or recolour them, or remove the ones you do not use. The number is how many transactions carry the flag.</p>
      <ErrorNote error={error} />
      {flags && !flags.length && <p className="py-3 text-sm text-muted">No flags yet.</p>}
      <ul className="divide-y divide-line">{(flags || []).map((f) => <FlagRow key={f.id} flag={f} />)}</ul>
      <form onSubmit={add} className="mt-3 space-y-3 border-t border-line pt-4">
        <div className="section-title">New flag</div>
        <Palette value={color || suggested} onChange={setColor} />
        <div className="flex gap-2">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name, for example To reimburse" aria-label="New flag name" required />
          <button className="btn btn-primary shrink-0" disabled={adding || !name.trim()}><Icon name="plus" size={16} /> Add</button>
        </div>
        <ErrorNote error={addError} />
      </form>
    </Modal>
  );
}
