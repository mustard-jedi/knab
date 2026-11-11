import { useEffect, useState } from 'react';
import { periodFor, periodTitle, todayStr } from '../../../shared/periods.js';
import { api, download } from '../api.js';
import { useApp } from '../state.jsx';
import { ErrorNote, Field, Modal, PageHeader, useAction } from '../ui.jsx';
import { NewBudgetForm } from '../App.jsx';

function Section({ title, description, children }) {
  return (
    <section className="card p-4">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function BudgetSettings() {
  const { budget, loadBudgets, bump } = useApp();
  const [name, setName] = useState(budget.name);
  const [currency, setCurrency] = useState(budget.currency);
  const [cutoff, setCutoff] = useState(String(budget.cutoff_day));
  const [saved, setSaved] = useState(false);
  useEffect(() => { setName(budget.name); setCurrency(budget.currency); setCutoff(String(budget.cutoff_day)); }, [budget]);

  const day = Math.min(31, Math.max(1, Number(cutoff) || 1));
  const [save, busy, error] = useAction(async (e) => {
    e.preventDefault();
    setSaved(false);
    await api('PATCH', `/budgets/${budget.id}`, { name, currency, cutoff_day: day });
    await loadBudgets(budget.id);
    bump();
    setSaved(true);
  });

  return (
    <Section title="This budget" description="The period start day sets the date range used on the budget, transaction and report screens.">
      <form onSubmit={save} className="space-y-4">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency"><input className="input uppercase" value={currency} onChange={(e) => setCurrency(e.target.value)} pattern="[A-Za-z]{3}" maxLength={3} required /></Field>
          <Field label="Period starts on day"><input className="input" type="number" min="1" max="31" value={cutoff} onChange={(e) => setCutoff(e.target.value)} required /></Field>
        </div>
        <p className="text-sm text-muted">
          With day {day}, the current period is <span className="num font-medium text-ink">{periodTitle(periodFor(todayStr(), day))}</span>.
          {day !== budget.cutoff_day && ' Changing it moves past transactions into the new date ranges; the amounts you assigned stay with their period.'}
          {day > 28 && ' In shorter months the period starts on the last day of the month.'}
        </p>
        <ErrorNote error={error} />
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" disabled={busy}>Save</button>
          {saved && <span className="text-sm text-pos">Saved</span>}
        </div>
      </form>
    </Section>
  );
}

function Sharing() {
  const { budget } = useApp();
  const [members, setMembers] = useState(null);
  const [username, setUsername] = useState('');
  const [reload, , loadError] = useAction(async () => setMembers(await api('GET', `/budgets/${budget.id}/members`)));
  useEffect(() => { reload(); }, [budget.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [invite, inviting, inviteError] = useAction(async (e) => {
    e.preventDefault();
    await api('POST', `/budgets/${budget.id}/members`, { username });
    setUsername('');
    await reload();
  });
  const [remove, , removeError] = useAction(async (m) => {
    if (!window.confirm(`Stop sharing this budget with ${m.username}?`)) return;
    await api('DELETE', `/budgets/${budget.id}/members/${m.id}`);
    await reload();
  });
  return (
    <Section title="Sharing" description={`People you invite can see and edit everything in “${budget.name}”. Your other budgets stay private.`}>
      {members?.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-1 pr-1 pl-3 text-sm">
              {m.username}
              <button className="btn btn-ghost min-h-8 px-2 text-xs text-neg" onClick={() => remove(m)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {members && !members.length && <p className="text-sm text-muted">Not shared with anyone.</p>}
      <form onSubmit={invite} className="flex items-end gap-3">
        <Field label="Username to invite" className="flex-1"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" required /></Field>
        <button className="btn btn-primary" disabled={inviting}>Invite</button>
      </form>
      <ErrorNote error={inviteError || removeError || loadError} />
    </Section>
  );
}

function Tokens() {
  const { budget, version } = useApp();
  const [tokens, setTokens] = useState([]);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null);
  const [copied, setCopied] = useState(false);
  const [reload] = useAction(async () => setTokens(await api('GET', '/tokens')));
  useEffect(() => { reload(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [create, creating, createError] = useAction(async (e) => {
    e.preventDefault();
    setCopied(false);
    setFresh(await api('POST', '/tokens', { name, budget_id: budget.id }));
    setName('');
    await reload();
  });
  const [revoke, , revokeError] = useAction(async (t) => {
    if (!window.confirm(`Revoke the token “${t.name}”? Anything using it will stop working.`)) return;
    await api('DELETE', `/tokens/${t.id}`);
    await reload();
  });
  const origin = window.location.origin;
  const example = `curl -X POST ${origin}/api/v1/transactions \\
  -H "Authorization: Bearer ${fresh ? fresh.token : 'YOUR_TOKEN'}" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": 12.50, "type": "expense", "account": "Checking", "category": "Groceries"}'`;

  return (
    <Section title="API tokens" description={`A token lets a script or a local AI model add transactions to “${budget.name}” without your password.`}>
      {fresh && (
        <div className="space-y-2 rounded-lg border border-pos bg-pos-bg p-3 text-sm">
          <p className="font-medium text-pos">Copy this token now. It will not be shown again.</p>
          <code className="block rounded bg-surface p-2 text-xs break-all text-ink">{fresh.token}</code>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(fresh.token).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy token'}</button>
        </div>
      )}
      {tokens.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 py-1 pr-1 pl-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{t.name}</span>
                <span className="block truncate text-xs text-muted">{t.budget} · {t.last_used_at ? `last used ${t.last_used_at.slice(0, 10)}` : 'never used'}</span>
              </span>
              <button className="btn btn-ghost min-h-8 px-2 text-xs text-neg" onClick={() => revoke(t)}>Revoke</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} className="flex items-end gap-3">
        <Field label="Token name" className="flex-1"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Home assistant" required /></Field>
        <button className="btn btn-primary" disabled={creating}>Create</button>
      </form>
      <ErrorNote error={createError || revokeError} />
      <div>
        <p className="label">Example request</p>
        <pre className="overflow-x-auto rounded-lg bg-sunken p-3 text-xs">{example}</pre>
        <p className="mt-2 text-sm text-muted">
          Full reference: <a className="text-accent underline" href="/api/docs" target="_blank" rel="noreferrer">API documentation</a> ·{' '}
          <a className="text-accent underline" href="/api/v1/schema/transaction" target="_blank" rel="noreferrer">transaction JSON Schema</a>
        </p>
      </div>
    </Section>
  );
}

function Users() {
  const { me } = useApp();
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reload] = useAction(async () => setUsers(await api('GET', '/users')));
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [create, creating, createError] = useAction(async (e) => {
    e.preventDefault();
    await api('POST', '/users', { username: username.trim(), password });
    setUsername('');
    setPassword('');
    await reload();
  });
  const [act, , actError] = useAction(async (kind, u) => {
    if (kind === 'delete') {
      if (!window.confirm(`Delete ${u.username}? Budgets they own are deleted too. This cannot be undone.`)) return;
      await api('DELETE', `/users/${u.id}`);
    } else {
      const next = window.prompt(`New password for ${u.username} (at least 8 characters):`);
      if (!next) return;
      await api('POST', `/users/${u.id}/password`, { new_password: next });
    }
    await reload();
  });
  return (
    <Section title="Users" description="Only an admin can add people. There is no public sign-up.">
      <ul className="divide-y divide-line rounded-lg border border-line">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-2 py-1 pr-1 pl-3 text-sm">
            <span>{u.username}{u.is_admin && <span className="ml-2 text-xs text-muted">admin</span>}</span>
            {u.id !== me.id && (
              <span className="flex gap-1">
                <button className="btn btn-ghost min-h-8 px-2 text-xs" onClick={() => act('password', u)}>Reset password</button>
                <button className="btn btn-ghost min-h-8 px-2 text-xs text-neg" onClick={() => act('delete', u)}>Delete</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Field label="New username"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="off" required /></Field>
        <Field label="Password (8+ characters)"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required /></Field>
        <button className="btn btn-primary" disabled={creating}>Add user</button>
      </form>
      <ErrorNote error={createError || actError} />
    </Section>
  );
}

function Account() {
  const { me, theme, setTheme, logout } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [done, setDone] = useState(false);
  const [change, busy, error] = useAction(async (e) => {
    e.preventDefault();
    setDone(false);
    await api('POST', '/auth/password', { current_password: current, new_password: next });
    setCurrent('');
    setNext('');
    setDone(true);
  });
  return (
    <Section title={`Signed in as ${me.username}`}>
      <Field label="Appearance">
        <select className="input md:w-48" value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="system">Match device</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Field>
      <form onSubmit={change} className="grid gap-3 border-t border-line pt-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Field label="Current password"><input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></Field>
        <Field label="New password (8+ characters)"><input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required /></Field>
        <button className="btn" disabled={busy}>Change password</button>
      </form>
      <ErrorNote error={error} />
      {done && <p className="text-sm text-pos">Password changed.</p>}
      <div className="border-t border-line pt-4"><button className="btn" onClick={logout}>Sign out</button></div>
    </Section>
  );
}

function BudgetsAndData() {
  const { budget, loadBudgets } = useApp();
  const [creating, setCreating] = useState(false);
  const [exportCsv, exporting, exportError] = useAction(() => download('/export/transactions.csv', `${budget.name}-transactions.csv`));
  const [remove, , removeError] = useAction(async () => {
    const typed = window.prompt(`This permanently deletes “${budget.name}” and all its accounts and transactions. Type the budget name to confirm:`);
    if (typed === null) return;
    if (typed.trim() !== budget.name) throw new Error('The name did not match, so nothing was deleted.');
    await api('DELETE', `/budgets/${budget.id}`);
    await loadBudgets();
  });
  return (
    <Section title="Budgets and data">
      <div className="flex flex-wrap gap-3">
        <button className="btn" onClick={() => setCreating(true)}>New budget</button>
        <button className="btn" onClick={exportCsv} disabled={exporting}>Export transactions (CSV)</button>
        {budget.is_owner && <button className="btn btn-danger" onClick={remove}>Delete this budget</button>}
      </div>
      <ErrorNote error={exportError || removeError} />
      {creating && (
        <Modal title="New budget" onClose={() => setCreating(false)}>
          <NewBudgetForm onDone={() => setCreating(false)} />
        </Modal>
      )}
    </Section>
  );
}

export default function Settings() {
  const { budget, me } = useApp();
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Settings" />
      {budget.is_owner ? <BudgetSettings /> : (
        <Section title="This budget" description={`“${budget.name}” is shared with you by ${budget.owner}. Only the owner can change its name, currency or period start day (currently day ${budget.cutoff_day}).`} />
      )}
      {budget.is_owner && <Sharing />}
      <Tokens />
      {me.is_admin && <Users />}
      <BudgetsAndData />
      <Account />
    </div>
  );
}
