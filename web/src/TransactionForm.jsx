import { useState } from 'react';
import { todayStr } from '../../shared/periods.js';
import { api } from './api.js';
import { store, useApp, useData } from './state.jsx';
import { ErrorNote, Field, Modal, parseAmount, useAction } from './ui.jsx';
import { FlagManager, FlagPicker } from './flags.jsx';

const FREQUENCIES = [
  ['', 'Does not repeat'],
  ['weekly', 'Every week'],
  ['biweekly', 'Every 2 weeks'],
  ['monthly', 'Every month'],
  ['yearly', 'Every year'],
];

// One form for three jobs: a new entry, editing a transaction, editing a schedule.
export default function TransactionForm({ transaction, schedule, defaults = {} }) {
  const { closeTxForm, bump, budget } = useApp();
  const accounts = useData('/accounts').data;
  const groups = useData('/categories').data;
  const payees = useData('/payees').data;
  const source = transaction || schedule;
  const isTransfer = transaction?.type === 'transfer';

  const [type, setType] = useState(source?.type || defaults.type || 'expense');
  const [amount, setAmount] = useState(source ? String(source.amount) : '');
  const [date, setDate] = useState(transaction?.date || schedule?.next_date || todayStr());
  const [account, setAccount] = useState(source?.account || defaults.account || store.get(`knab-account-${budget.id}`) || '');
  const [toAccount, setToAccount] = useState(transaction?.transfer_account || '');
  const [payee, setPayee] = useState(source?.payee || '');
  const [category, setCategory] = useState(source?.category || defaults.category || '');
  const [memo, setMemo] = useState(source?.memo || '');
  const [cleared, setCleared] = useState(transaction?.cleared || false);
  const [flag, setFlag] = useState(transaction?.flag || '');
  const [managingFlags, setManagingFlags] = useState(false);
  const [frequency, setFrequency] = useState(schedule?.frequency || '');
  const [endDate, setEndDate] = useState(schedule?.end_date || '');

  const open = (accounts || []).filter((a) => !a.closed || a.name === account || a.name === toAccount);
  // A remembered account may have been renamed or closed since.
  const accountName = open.some((a) => a.name === account) ? account : open[0]?.name || '';
  const transferTarget = toAccount && toAccount !== accountName ? toAccount : open.find((a) => a.name !== accountName)?.name || '';

  const [save, saving, saveError] = useAction(async (e) => {
    e.preventDefault();
    const value = parseAmount(amount);
    if (!(value > 0)) throw new Error('Enter an amount greater than zero.');
    const entry = { date, amount: value, type, account: accountName, payee, memo };
    if (schedule) {
      await api('PATCH', `/recurring/${schedule.id}`, { ...entry, category, frequency, end_date: endDate });
    } else if (isTransfer) {
      await api('PATCH', `/transactions/${transaction.id}`, { date, amount: value, memo, cleared, flag });
    } else if (transaction) {
      await api('PATCH', `/transactions/${transaction.id}`, { ...entry, category, cleared, flag });
    } else if (type === 'transfer') {
      await api('POST', '/transfers', { date, amount: value, from_account: accountName, to_account: transferTarget, memo, ...(flag ? { flag } : {}) });
    } else {
      if (category) entry.category = category;
      if (frequency) await api('POST', '/recurring', { ...entry, frequency, ...(endDate ? { end_date: endDate } : {}) });
      else await api('POST', '/transactions', { ...entry, cleared, ...(flag ? { flag } : {}) });
    }
    store.set(`knab-account-${budget.id}`, accountName);
    bump();
    closeTxForm();
  });

  const [remove, removing, removeError] = useAction(async () => {
    if (!window.confirm(schedule ? 'Stop this recurring transaction? Entries already posted stay.' : 'Delete this transaction?')) return;
    await api('DELETE', schedule ? `/recurring/${schedule.id}` : `/transactions/${transaction.id}`);
    bump();
    closeTxForm();
  });

  const title = schedule ? 'Edit recurring transaction' : transaction ? (isTransfer ? 'Edit transfer' : 'Edit transaction') : 'Add transaction';
  const types = [['expense', 'Expense'], ['income', 'Income'], ...(source ? [] : [['transfer', 'Transfer']])];
  const showRepeat = type !== 'transfer' && !transaction;

  if (accounts && !accounts.length) {
    return (
      <Modal title={title} onClose={closeTxForm}>
        <p className="text-sm text-muted">Add an account first (Accounts → Add account), then you can record transactions.</p>
      </Modal>
    );
  }

  return (
    <>
    <Modal title={title} onClose={closeTxForm}>
      <form onSubmit={save} className="space-y-4">
        {!isTransfer && (
          <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-sunken p-1" role="radiogroup" aria-label="Type">
            {types.map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={type === value} onClick={() => setType(value)}
                className={`min-h-10 cursor-pointer rounded-md text-sm font-medium ${type === value ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        <Field label="Amount">
          <input className="input num h-14 text-2xl font-semibold md:text-2xl" inputMode="decimal" placeholder="0.00" value={amount}
            onChange={(e) => setAmount(e.target.value)} autoFocus={!source} required />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={schedule ? 'Next date' : 'Date'}>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label={type === 'transfer' || isTransfer ? 'From account' : 'Account'}>
            <select className="input" value={accountName} onChange={(e) => setAccount(e.target.value)} disabled={isTransfer}>
              {open.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
            </select>
          </Field>
        </div>

        {type === 'transfer' || isTransfer ? (
          <Field label="To account">
            <select className="input" value={transferTarget} onChange={(e) => setToAccount(e.target.value)} disabled={isTransfer} required>
              {open.filter((a) => a.name !== accountName).map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
            </select>
          </Field>
        ) : (
          <>
            <Field label="Payee">
              <input className="input" list="knab-payees" value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={200}
                placeholder={type === 'income' ? 'Who paid you' : 'Who you paid'} />
              <datalist id="knab-payees">{(payees || []).map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
            <Field label="Category" hint={type === 'income' ? 'Leave as Ready to Assign for pay and other income.' : undefined}>
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} required={type === 'expense' && !transaction?.opening_balance}>
                <option value="">{type === 'income' ? 'Ready to Assign' : 'Choose a category…'}</option>
                {(groups || []).map((g) => (
                  <optgroup key={g.id} label={g.name}>
                    {g.categories.filter((c) => !c.hidden || c.name === category).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
          </>
        )}

        <Field label="Memo">
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} placeholder="Optional note" />
        </Field>

        {!schedule && !frequency && <FlagPicker value={flag} onChange={setFlag} onManage={() => setManagingFlags(true)} />}

        {(showRepeat || schedule) && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Repeat">
              <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                {FREQUENCIES.filter(([v]) => v || !schedule).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            {frequency && (
              <Field label="Until (optional)">
                <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
            )}
          </div>
        )}

        {!schedule && !frequency && (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 accent-(--accent)" checked={cleared} onChange={(e) => setCleared(e.target.checked)} />
            Cleared at the bank
          </label>
        )}

        <ErrorNote error={saveError || removeError} />
        <div className="flex gap-3">
          {source && <button type="button" className="btn btn-danger" onClick={remove} disabled={removing}>{schedule ? 'Stop' : 'Delete'}</button>}
          <button className="btn btn-primary flex-1" disabled={saving || !accounts}>Save</button>
        </div>
      </form>
    </Modal>
    {managingFlags && <FlagManager onClose={() => setManagingFlags(false)} />}
    </>
  );
}
