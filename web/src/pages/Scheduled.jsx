import { shortDate } from '../../../shared/periods.js';
import { api } from '../api.js';
import { useApp, useData } from '../state.jsx';
import { Empty, ErrorNote, Money, PageHeader, useAction } from '../ui.jsx';

const EVERY = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month', yearly: 'Every year' };

export default function Scheduled() {
  const { openTxForm, bump } = useApp();
  const { data, error } = useData('/recurring');
  const [skip, skipping, skipError] = useAction(async (r) => {
    if (!window.confirm(`Skip the ${shortDate(r.next_date, true)} occurrence?`)) return;
    await api('POST', `/recurring/${r.id}/skip`);
    bump();
  });

  if (error) return <ErrorNote error={error} />;
  if (!data) return <p className="text-muted">Loading…</p>;

  return (
    <div>
      <PageHeader title="Scheduled" />
      <p className="mb-4 text-sm text-muted">Recurring transactions are added to your accounts automatically on their date. To create one, add a transaction and choose how often it repeats.</p>
      <ErrorNote error={skipError} />
      {!data.length ? (
        <Empty title="Nothing scheduled">
          <button className="btn btn-primary mt-2" onClick={() => openTxForm({})}>Add a transaction</button>
        </Empty>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-48">
                <div className="truncate font-medium">{r.payee || (r.type === 'income' ? 'Income' : 'Expense')}</div>
                <div className="truncate text-xs text-muted">
                  {EVERY[r.frequency]} · next {shortDate(r.next_date, true)} · {r.account}{r.category ? ` · ${r.category}` : ''}
                  {r.end_date ? ` · until ${shortDate(r.end_date, true)}` : ''}
                </div>
              </div>
              <Money value={r.type === 'expense' ? -r.amount : r.amount} signed className="font-semibold" />
              <div className="flex gap-2">
                <button className="btn" onClick={() => skip(r)} disabled={skipping}>Skip next</button>
                <button className="btn" onClick={() => openTxForm({ schedule: r })}>Edit</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
