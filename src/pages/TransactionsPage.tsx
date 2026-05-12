import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { ArrowDownLeft, ArrowUpRight, Download, Loader2, Pencil, Plus, ReceiptText, Search, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { AccountBrandMark } from '../components/visual/AccountBrandMark';
import { EmptyState } from '../components/visual/EmptyState';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
import { useTransactions } from '../hooks/useTransactions';
import { addTransaction, deleteTransaction, getAccounts, updateTransaction } from '../lib/firestore';
import { exportTransactionsToExcel } from '../lib/exportExcel';
import {
  inferMovementKind,
  isProtectedTransaction,
  isReportableFinancialTransaction,
  parseCurrencyInput,
  toMoney,
} from '../lib/accounting';
import { CATEGORIES, formatCOP } from '../types';
import type { Account, Transaction, TransactionType } from '../types';
import clsx from 'clsx';

type TxFormState = {
  type: TransactionType;
  amount: string;
  category: string;
  accountId: string;
  description: string;
  date: string;
  time: string;
};

const pad = (value: number) => String(value).padStart(2, '0');
const toDateInput = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const toTimeInput = (date = new Date()) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

function buildDate(date: string, time: string): Date {
  const parsed = new Date(`${date || toDateInput()}T${time || '12:00'}:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function defaultForm(accounts: Account[], type: TransactionType = 'expense'): TxFormState {
  return {
    type,
    amount: '',
    category: type === 'income' ? 'Ingreso' : 'Otros',
    accountId: accounts[0]?.id || '',
    description: '',
    date: toDateInput(),
    time: toTimeInput(),
  };
}

function formFromTransaction(tx: Transaction): TxFormState {
  return {
    type: tx.type,
    amount: String(tx.amount),
    category: tx.category || (tx.type === 'income' ? 'Ingreso' : 'Otros'),
    accountId: tx.accountId,
    description: tx.description || '',
    date: toDateInput(tx.date),
    time: toTimeInput(tx.date),
  };
}

function kindLabel(tx: Transaction): string {
  const kind = inferMovementKind(tx);
  const labels: Record<string, string> = {
    income: 'Ingreso reportable',
    expense: 'Gasto reportable',
    transfer_out: 'Transferencia salida',
    transfer_in: 'Transferencia entrada',
    loan_given: 'Préstamo otorgado',
    loan_received: 'Préstamo recibido',
    loan_payment_received: 'Abono recibido',
    debt_payment_made: 'Pago de deuda',
    payable_expense_created: 'Gasto pendiente creado',
    payable_expense_paid: 'Gasto pendiente pagado',
    reconciliation_adjustment: 'Ajuste de conciliación',
    historical_non_reportable: 'Histórico / no reportable',
    legacy: 'Legacy / revisar',
  };
  return labels[kind] || kind;
}

export function TransactionsPage() {
  const { user } = useAuth();
  const { transactions, loading, refresh } = useTransactions();
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [search, setSearch] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [form, setForm] = useState<TxFormState>(() => defaultForm([]));
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getAccounts(user.uid).then(setAccounts).catch(() => setAccounts([]));
  }, [user]);

  const filtered = useMemo(() => transactions.filter((tx) => {
    const query = search.toLowerCase();
    const matchesType = filterType === 'all' || tx.type === filterType;
    const matchesSearch = tx.description.toLowerCase().includes(query) || tx.category.toLowerCase().includes(query) || tx.accountName.toLowerCase().includes(query);
    return matchesType && matchesSearch;
  }), [transactions, filterType, search]);

  const totals = useMemo(() => filtered.reduce((acc, tx) => {
    const amount = toMoney(tx.amount);
    if (isReportableFinancialTransaction(tx)) {
      if (tx.type === 'income') acc.reportableIncome += amount;
      if (tx.type === 'expense') acc.reportableExpense += amount;
    } else if (inferMovementKind(tx) === 'historical_non_reportable') {
      acc.historical += amount;
    } else if (inferMovementKind(tx).startsWith('transfer')) {
      acc.transfers += amount;
    } else if (isProtectedTransaction(tx)) {
      acc.protected += amount;
    }
    return acc;
  }, { reportableIncome: 0, reportableExpense: 0, historical: 0, transfers: 0, protected: 0 }), [filtered]);

  const accountOptions = accounts.map((account) => ({ value: account.id, label: account.name }));
  const categoryOptions = CATEGORIES.map((category) => ({ value: category, label: category }));

  const openCreateForm = (type?: TransactionType) => {
    const initialType = type || (filterType === 'income' || filterType === 'expense' ? filterType : 'expense');
    setEditingTx(null);
    setForm(defaultForm(accounts, initialType));
    setFormError('');
    setFormOpen(true);
  };

  const openEditForm = (tx: Transaction) => {
    if (isProtectedTransaction(tx)) {
      setFormError('Este movimiento está protegido. Para corregirlo usa reverso/flujo contable, no edición manual.');
      return;
    }
    setEditingTx(tx);
    setForm(formFromTransaction(tx));
    setFormError('');
    setFormOpen(true);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;

    let amount = 0;
    try {
      amount = parseCurrencyInput(form.amount);
    } catch (error: any) {
      setFormError(error?.message || 'Escribe un valor válido en COP.');
      return;
    }

    const account = accounts.find((item) => item.id === form.accountId);
    if (!account) return setFormError('Selecciona una cuenta válida.');
    if (editingTx && isProtectedTransaction(editingTx)) return setFormError('Este movimiento protegido no se puede editar manualmente.');

    setSaving(true);
    try {
      const description = form.description.trim() || (form.type === 'income' ? 'Ingreso manual' : 'Gasto manual');
      const payload = {
        type: form.type,
        amount,
        currency: 'COP' as const,
        category: form.category || (form.type === 'income' ? 'Ingreso' : 'Otros'),
        accountId: account.id,
        accountName: account.name,
        description,
        date: buildDate(form.date, form.time),
        rawText: editingTx ? `Edición manual: ${description}` : `Registro manual: ${description}`,
        source: 'manual' as const,
        confidence: 1,
        movementKind: form.type === 'income' ? 'income' as const : 'expense' as const,
        affectsCash: true,
        affectsReport: true,
      };

      if (editingTx) await updateTransaction(user.uid, editingTx.id, payload as Partial<Transaction>);
      else await addTransaction(user.uid, payload);

      await refresh();
      setAccounts(await getAccounts(user.uid).catch(() => accounts));
      setFormOpen(false);
      setEditingTx(null);
    } catch (error: any) {
      setFormError(error?.message || 'No pude guardar el movimiento.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tx: Transaction) => {
    if (!user) return;
    if (isProtectedTransaction(tx)) {
      setFormError('Este movimiento está protegido. Usa reverso contable para conservar trazabilidad.');
      return;
    }
    setBusyId(tx.id);
    try {
      await deleteTransaction(user.uid, tx.id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6 pb-10">
      <section className="lux-hero relative p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="lux-kicker">Libro contable</p>
            <h1 className="lux-heading mt-2 text-3xl sm:text-4xl">Movimientos</h1>
            <p className="lux-subtle mt-2 max-w-2xl text-sm">Los totales usan el motor contable: separan reportables, históricos, transferencias y movimientos protegidos.</p>
          </div>
          <div className="grid gap-3 sm:min-w-[640px] sm:grid-cols-5">
            <Metric title="Ingresos reportables" value={totals.reportableIncome} tone="green" />
            <Metric title="Gastos reportables" value={totals.reportableExpense} tone="red" />
            <Metric title="Históricos" value={totals.historical} tone="purple" />
            <Metric title="Transferencias" value={totals.transfers} tone="blue" />
            <Button className="h-full min-h-[72px] rounded-3xl" icon={<Plus className="h-4 w-4" />} onClick={() => openCreateForm()}>Manual</Button>
          </div>
        </div>
      </section>

      {formError && <div className="mx-1 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm font-bold text-amber-100">{formError}</div>}

      <section className="lux-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Input placeholder="Buscar movimiento, categoría o cuenta..." value={search} onChange={(event) => setSearch(event.target.value)} icon={<Search className="h-4 w-4" />} className="w-full lg:w-96" />
          <div className="flex flex-wrap gap-2">
            <Button variant={filterType === 'all' ? 'primary' : 'ghost'} size="sm" onClick={() => setFilterType('all')}>Todos</Button>
            <Button variant={filterType === 'income' ? 'success' : 'ghost'} size="sm" onClick={() => setFilterType('income')} icon={<ArrowUpRight className="h-4 w-4" />}>Ingresos</Button>
            <Button variant={filterType === 'expense' ? 'danger' : 'ghost'} size="sm" onClick={() => setFilterType('expense')} icon={<ArrowDownLeft className="h-4 w-4" />}>Salidas</Button>
            <Button variant="ghost" size="sm" onClick={() => exportTransactionsToExcel(filtered, 'finanzas-organizadas-ingresos-egresos.xlsx')} disabled={filtered.length === 0} icon={<Download className="h-4 w-4" />}>Excel</Button>
          </div>
        </div>
      </section>

      <section className="premium-panel overflow-hidden rounded-[1.6rem] border border-slate-700/40">
        {loading ? (
          <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-400" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-5"><EmptyState asset="transactions" title="No hay movimientos" description="Registra ingresos y gastos o ajusta los filtros." /></div>
        ) : (
          <div className="grid gap-3 p-3">
            {filtered.map((tx) => {
              const protectedTx = isProtectedTransaction(tx);
              return (
                <article key={tx.id} className="rounded-3xl border border-slate-700/40 bg-slate-900/35 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <AccountBrandMark name={tx.accountName} size="md" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-100">{tx.description}</p>
                        <p className="mt-1 text-xs text-slate-500">{format(tx.date, 'dd MMM yyyy, HH:mm', { locale: es })} · {tx.accountName}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge><ReceiptText className="h-3 w-3" />{tx.category}</Badge>
                          <Badge>{kindLabel(tx)}</Badge>
                          {protectedTx && <Badge>Protegido</Badge>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 lg:min-w-[260px] lg:justify-end">
                      <p className={clsx('text-sm font-black', tx.type === 'income' ? 'text-green-300' : 'text-red-300')}>{tx.type === 'income' ? '+' : '-'}{formatCOP(tx.amount)}</p>
                      <button onClick={() => openEditForm(tx)} disabled={protectedTx} className="rounded-xl p-2 text-slate-500 transition hover:bg-blue-500/10 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-30"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => handleDelete(tx)} disabled={protectedTx || busyId === tx.id} className="rounded-xl p-2 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30">{busyId === tx.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="premium-panel w-full max-w-2xl rounded-[2rem] border border-slate-700/50 p-5 shadow-2xl shadow-black/40">
            <h2 className="text-2xl font-black text-slate-100">{editingTx ? 'Editar movimiento reportable' : 'Nuevo movimiento reportable'}</h2>
            <p className="mt-1 text-sm text-slate-400">Solo para ingresos/gastos normales. Transferencias y deudas usan sus flujos protegidos.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Select label="Tipo" value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as TransactionType, category: event.target.value === 'income' ? 'Ingreso' : 'Otros' }))} options={[{ value: 'income', label: 'Ingreso' }, { value: 'expense', label: 'Gasto' }]} />
              <Input label="Valor" inputMode="numeric" placeholder="Ej: 45.000" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} />
              <Select label="Cuenta" value={form.accountId} onChange={(event) => setForm((current) => ({ ...current, accountId: event.target.value }))} options={accountOptions.length ? accountOptions : [{ value: '', label: 'Sin cuentas' }]} />
              <Select label="Categoría" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} options={categoryOptions} />
              <Input label="Descripción" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="sm:col-span-2" />
              <Input label="Fecha" type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} />
              <Input label="Hora" type="time" value={form.time} onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))} />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</Button>
              <Button type="submit" loading={saving}>Guardar</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Metric({ title, value, tone }: { title: string; value: number; tone: 'green' | 'red' | 'purple' | 'blue' }) {
  const toneClass = {
    green: 'border-green-400/20 bg-green-400/10 text-green-300',
    red: 'border-red-400/20 bg-red-400/10 text-red-300',
    purple: 'border-purple-400/20 bg-purple-400/10 text-purple-300',
    blue: 'border-blue-400/20 bg-blue-400/10 text-blue-300',
  }[tone];
  return <div className={clsx('rounded-3xl border p-4', toneClass)}><p className="text-[10px] font-black uppercase tracking-[0.16em]">{title}</p><p className="mt-1 text-lg font-black text-slate-100">{formatCOP(value)}</p></div>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/30 bg-slate-800/50 px-3 py-1 text-[10px] font-bold text-slate-300">{children}</span>;
}
