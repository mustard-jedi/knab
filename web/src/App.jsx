import { useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { useApp, useData } from './state.jsx';
import { ErrorNote, Field, Icon, useAction } from './ui.jsx';
import TransactionForm from './TransactionForm.jsx';
import Budget from './pages/Budget.jsx';
import Accounts, { AccountForm } from './pages/Accounts.jsx';
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

const CASH_TYPES = ['checking', 'savings', 'cash', 'other'];

function SideAccounts({ title, accounts, active }) {
  const { money } = useApp();
  if (!accounts.length) return null;
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  return (
    <div>
      <div className="flex items-center justify-between px-3 py-1 text-[11px] font-semibold tracking-wider text-side-muted uppercase">
        <span>{title}</span><span className="num">{money(total)}</span>
      </div>
      {accounts.map((a) => (
        <Link key={a.id} to={`/transactions?account=${encodeURIComponent(a.name)}`}
          className={`flex items-center justify-between gap-2 rounded-lg py-1.5 pr-3 pl-5 text-sm ${active === a.name.toLowerCase() ? 'bg-white/15 font-medium' : 'hover:bg-white/10'}`}>
          <span className="truncate">{a.name}</span>
          <span className={`num shrink-0 text-xs ${a.balance < -0.005 ? 'rounded-full bg-neg-bg px-2 py-0.5 font-semibold text-neg' : ''}`}>{money(a.balance)}</span>
        </Link>
      ))}
    </div>
  );
}

function Shell() {
  const { budget, budgets, selectBudget, openTxForm, txForm } = useApp();
  const location = useLocation();
  const accounts = useData('/accounts').data || [];
  const [addingAccount, setAddingAccount] = useState(false);
  const onRegister = location.pathname === '/transactions';
  const activeAccount = onRegister ? (new URLSearchParams(location.search).get('account') || '').toLowerCase() : null;
  const open = accounts.filter((a) => !a.closed);

  const sideLink = (isActive) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-white/15' : 'text-side-ink hover:bg-white/10'}`;
  const tabClass = ({ isActive }) =>
    `flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-accent' : 'text-muted'}`;
  const mobile = NAV.filter((n) => n.mobile);

  const picker = (className) => (budgets.length > 1 ? (
    <select className={className} value={budget.id} onChange={(e) => selectBudget(Number(e.target.value))} aria-label="Budget">
      {budgets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  ) : <div className="truncate px-1 font-semibold">{budget.name}</div>);

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-3 overflow-y-auto bg-side p-3 text-side-ink md:flex">
        <div className="flex items-center gap-2 px-2 pt-1">
          <img src="/favicon.svg" alt="" className="size-7" />
          <div className="min-w-0 flex-1">{picker('w-full cursor-pointer rounded-md bg-white/10 px-2 py-1 font-semibold text-side-ink')}</div>
        </div>
        <button type="button" className="btn btn-primary border-transparent" onClick={() => openTxForm({})}><Icon name="plus" size={18} /> Add transaction</button>
        <nav className="flex flex-col gap-0.5">
          <NavLink to="/" end className={({ isActive }) => sideLink(isActive)}><Icon name="budget" size={18} />Budget</NavLink>
          <NavLink to="/reports" className={({ isActive }) => sideLink(isActive)}><Icon name="chart" size={18} />Reports</NavLink>
          <Link to="/transactions" className={sideLink(onRegister && !activeAccount)}><Icon name="accounts" size={18} />All accounts</Link>
        </nav>
        <div className="flex flex-col gap-3">
          <SideAccounts title="Cash" accounts={open.filter((a) => CASH_TYPES.includes(a.type))} active={activeAccount} />
          <SideAccounts title="Credit" accounts={open.filter((a) => a.type === 'credit')} active={activeAccount} />
          <button type="button" onClick={() => setAddingAccount(true)}
            className="mx-1 flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg bg-white/10 text-sm font-medium hover:bg-white/15">
            <Icon name="plus" size={16} /> Add account
          </button>
        </div>
        <nav className="mt-auto flex flex-col gap-0.5 border-t border-white/10 pt-3">
          <NavLink to="/scheduled" className={({ isActive }) => sideLink(isActive)}><Icon name="repeat" size={18} />Scheduled</NavLink>
          <NavLink to="/accounts" className={({ isActive }) => sideLink(isActive)}><Icon name="list" size={18} />Manage accounts</NavLink>
          <NavLink to="/settings" className={({ isActive }) => sideLink(isActive)}><Icon name="settings" size={18} />Settings</NavLink>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface px-4 py-2 md:hidden">{picker('input font-semibold')}</header>
        <main className="w-full flex-1 px-4 pt-4 pb-28 md:px-6 md:pt-6 md:pb-10">
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
      {addingAccount && <AccountForm onClose={() => setAddingAccount(false)} />}
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
