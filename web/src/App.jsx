import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api.js';
import { useApp } from './state.jsx';
import { ErrorNote, Field, Icon, useAction } from './ui.jsx';
import TransactionForm from './TransactionForm.jsx';
import Budget from './pages/Budget.jsx';
import Accounts from './pages/Accounts.jsx';
import Transactions from './pages/Transactions.jsx';
import Scheduled from './pages/Scheduled.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { to: '/', label: 'Budget', icon: 'budget', mobile: true },
  { to: '/accounts', label: 'Accounts', icon: 'accounts', mobile: true },
  { to: '/transactions', label: 'Transactions', icon: 'list' },
  { to: '/scheduled', label: 'Scheduled', icon: 'repeat' },
  { to: '/reports', label: 'Reports', icon: 'chart', mobile: true },
  { to: '/settings', label: 'Settings', icon: 'settings', mobile: true },
];

function Centered({ children }) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-2xl font-semibold">
          <img src="/favicon.svg" alt="" className="size-8" /> Knab
        </div>
        {children}
      </div>
    </div>
  );
}

function AuthScreen({ setup }) {
  const { boot } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submit, busy, error] = useAction(async (e) => {
    e.preventDefault();
    await api('POST', setup ? '/setup' : '/auth/login', { username: username.trim(), password });
    await boot();
  });
  return (
    <Centered>
      <form onSubmit={submit} className="card space-y-4 p-5">
        <div>
          <h1 className="text-lg font-semibold">{setup ? 'Create the admin account' : 'Sign in'}</h1>
          {setup && <p className="mt-1 text-sm text-muted">This first account manages users. You can add family members afterwards.</p>}
        </div>
        <Field label="Username" hint={setup ? '3–32 letters, digits, dot, dash or underscore' : undefined}>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus required />
        </Field>
        <Field label="Password" hint={setup ? 'At least 8 characters' : undefined}>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 8 : undefined} required />
        </Field>
        <ErrorNote error={error} />
        <button className="btn btn-primary w-full" disabled={busy}>{setup ? 'Create account' : 'Sign in'}</button>
      </form>
    </Centered>
  );
}

export function NewBudgetForm({ onDone, submitLabel = 'Create budget' }) {
  const { loadBudgets } = useApp();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [cutoff, setCutoff] = useState('1');
  const [submit, busy, error] = useAction(async (e) => {
    e.preventDefault();
    const created = await api('POST', '/budgets', { name, currency, cutoff_day: Number(cutoff) });
    await loadBudgets(created.id);
    onDone?.();
  });
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Budget name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Household" required autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Currency" hint="3-letter code, e.g. USD, EUR, PHP">
          <input className="input uppercase" value={currency} onChange={(e) => setCurrency(e.target.value)} pattern="[A-Za-z]{3}" maxLength={3} required />
        </Field>
        <Field label="Period starts on day" hint="23 means Jan 23 – Feb 22">
          <input className="input" type="number" min="1" max="31" value={cutoff} onChange={(e) => setCutoff(e.target.value)} required />
        </Field>
      </div>
      <ErrorNote error={error} />
      <button className="btn btn-primary w-full" disabled={busy}>{submitLabel}</button>
    </form>
  );
}

function FirstBudget() {
  const { logout, me } = useApp();
  return (
    <Centered>
      <div className="card space-y-4 p-5">
        <div>
          <h1 className="text-lg font-semibold">Create your first budget</h1>
          <p className="mt-1 text-sm text-muted">It starts with a few common categories that you can change later. If someone is sharing a budget with you, it will appear here once they invite “{me.username}”.</p>
        </div>
        <NewBudgetForm />
        <button type="button" className="btn btn-ghost w-full" onClick={logout}>Sign out</button>
      </div>
    </Centered>
  );
}

function Shell() {
  const { budget, budgets, selectBudget, openTxForm, txForm } = useApp();
  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-sunken text-ink' : 'text-muted hover:bg-sunken hover:text-ink'}`;
  const tabClass = ({ isActive }) =>
    `flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-accent' : 'text-muted'}`;
  const mobile = NAV.filter((n) => n.mobile);

  const budgetPicker = budgets.length > 1 ? (
    <select className="input font-semibold" value={budget.id} onChange={(e) => selectBudget(Number(e.target.value))} aria-label="Budget">
      {budgets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  ) : <div className="truncate px-1 font-semibold">{budget.name}</div>;

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 border-r border-line bg-surface p-4 md:flex">
        <div className="flex items-center gap-2 px-1 text-lg font-semibold"><img src="/favicon.svg" alt="" className="size-6" /> Knab</div>
        {budgetPicker}
        <button type="button" className="btn btn-primary" onClick={() => openTxForm({})}><Icon name="plus" size={18} /> Add transaction</button>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'} className={linkClass}><Icon name={n.icon} size={18} />{n.label}</NavLink>)}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface px-4 py-2 md:hidden">{budgetPicker}</header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-28 md:px-8 md:pt-8 md:pb-10">
          <Routes>
            <Route path="/" element={<Budget />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/scheduled" element={<Scheduled />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {mobile.slice(0, 2).map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'} className={tabClass}><Icon name={n.icon} />{n.label}</NavLink>)}
        <div className="flex flex-1 items-center justify-center">
          <button type="button" onClick={() => openTxForm({})} aria-label="Add transaction"
            className="-mt-5 flex size-14 cursor-pointer items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg">
            <Icon name="plus" size={26} />
          </button>
        </div>
        {mobile.slice(2).map((n) => <NavLink key={n.to} to={n.to} className={tabClass}><Icon name={n.icon} />{n.label}</NavLink>)}
      </nav>

      {txForm && <TransactionForm {...txForm} />}
    </div>
  );
}

export default function App() {
  const { phase, budget, boot } = useApp();
  if (phase === 'loading') return <div className="flex min-h-full items-center justify-center text-muted">Loading…</div>;
  if (phase === 'error') {
    return (
      <Centered>
        <div className="card space-y-3 p-5 text-center">
          <p>Could not reach the server.</p>
          <button className="btn btn-primary" onClick={boot}>Try again</button>
        </div>
      </Centered>
    );
  }
  if (phase === 'setup') return <AuthScreen setup />;
  if (phase === 'login') return <AuthScreen />;
  if (!budget) return <FirstBudget />;
  return <Shell />;
}
