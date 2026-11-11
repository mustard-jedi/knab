import { useState } from 'react';
import { Link } from 'react-router-dom';
import { todayStr } from '../../../shared/periods.js';
import { api, qs } from '../api.js';
import { useApp, useData } from '../state.jsx';
import { Empty, ErrorNote, Field, Icon, Modal, Money, PageHeader, parseAmount, useAction } from '../ui.jsx';

const TYPES = [['checking', 'Checking'], ['savings', 'Savings'], ['cash', 'Cash'], ['credit', 'Credit card'], ['other', 'Other']];
const typeLabel = (t) => TYPES.find(([v]) => v === t)?.[1] || t;

export function AccountForm({ account, onClose }) {
  const { bump } = useApp();
  const [name, setName] = useState(account?.name || '');
  const [type, setType] = useState(account?.type || 'checking');
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(todayStr());
  const [closed, setClosed] = useState(account?.closed || false);

  const [save, saving, saveError] = useAction(async (e) => {
    e.preventDefault();
    if (account) await api('PATCH', `/accounts/${account.id}`, { name, type, closed });
    else {
      const opening = balance.trim() === '' ? 0 : parseAmount(balance);
      if (Number.isNaN(opening)) throw new Error('The balance must be a number, for example 1250.00.');
      await api('POST', '/accounts', { name, type, opening_balance: opening, opening_date: date });
    }
    bump();
    onClose();
  });
  const [remove, removing, removeError] = useAction(async () => {
    if (!window.confirm(`Delete the account “${account.name}”?`)) return;
    await api('DELETE', `/accounts/${account.id}`);
    bump();
    onClose();
  });

  return (
    <Modal title={account ? 'Edit account' : 'Add account'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Checking" required autoFocus={!account} /></Field>
        <Field label="Type">
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {!account && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current balance" hint={type === 'credit' ? 'Enter what you owe as a negative number, e.g. -350.00' : 'Leave empty for zero'}>
              <input className="input num" inputMode={type === 'credit' ? 'text' : 'decimal'} value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="As of"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          </div>
        )}
        {account && (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 accent-(--accent)" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
            Closed (hidden when adding transactions; history is kept)
          </label>
        )}
        <ErrorNote error={saveError || removeError} />
        <div className="flex gap-3">
          {account && <button type="button" className="btn btn-danger" onClick={remove} disabled={removing}>Delete</button>}
          <button className="btn btn-primary flex-1" disabled={saving}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Accounts() {
  const { data, error } = useData('/accounts');
  const [form, setForm] = useState(null); // null | {} | account

  if (error) return <ErrorNote error={error} />;
  if (!data) return <p className="text-muted">Loading…</p>;
  const total = data.reduce((s, a) => s + a.balance, 0);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Accounts">
        <button className="btn btn-primary" onClick={() => setForm({})}><Icon name="plus" size={18} /> Add account</button>
      </PageHeader>

      {!data.length ? (
        <Empty title="No accounts yet">Add the accounts you spend from, such as a checking account, cash or a credit card, with their balance today.</Empty>
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {data.map((a) => (
            <div key={a.id} className="flex items-center gap-2 pr-2">
              <Link to={`/transactions${qs({ account: a.name })}`} className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 hover:bg-sunken">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className="text-xs text-muted">{typeLabel(a.type)}{a.closed ? ' · Closed' : ''}</span>
                </span>
                <Money value={a.balance} signed className="font-semibold" />
              </Link>
              <button className="btn btn-ghost px-2 text-muted" onClick={() => setForm(a)}>Edit</button>
            </div>
          ))}
          <div className="flex items-center justify-between bg-sunken px-4 py-3">
            <span className="text-sm font-semibold">Net total</span>
            <Money value={total} signed className="mr-14 font-semibold" />
          </div>
        </div>
      )}
      <p className="mt-4 text-sm"><Link className="text-accent underline" to="/transactions">See all transactions</Link></p>
      {form && <AccountForm account={form.id ? form : null} onClose={() => setForm(null)} />}
    </div>
  );
}
