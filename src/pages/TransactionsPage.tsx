import { useEffect, useMemo, useState } from 'react';
import { useTransactions } from '../hooks/useTransactions';
import { addTransaction, deleteTransaction, getAccounts, updateTransaction } from '../lib/firestore';
import { exportTransactionsToExcel } from '../lib/exportExcel';
import { useAuth } from '../contexts/AuthContext';
import { CATEGORIES, formatCOP } from '../types';
import type { Account, Transaction, TransactionType } from '../types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Trash2,
  Search,
  Bot,
  User,
  Loader2,
  Download,
  SlidersHorizontal,
  ReceiptText,
  Plus,
  Pencil,
  X,
  Save,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
import { AccountBrandMark } from '../components/visual/AccountBrandMark';
import { EmptyState } from '../components/visual/EmptyState';
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

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateInput(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInput(date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseMoneyInput(value: string): number {
  const clean = String(value || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
  const amount = Number.parseFloat(clean);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function buildDate(date: string, time: string): Date {
  const fallback = new Date();
  if (!date) return fallback;
  const parsed = new Date(`${date}T${time || '12:00'}:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function defaultForm(accounts: Account[], type: TransactionType = 'expense'): TxFormState {
  const account = accounts[0];
  return {
    type,
    amount: '',
    category: type === 'income' ? 'Ingreso' : 'Otros',
    accountId: account?.id || '',
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

export function TransactionsPage() {
  const { user } = useAuth();
  const { transactions, loading, refresh } = useTransactions();
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [form, setForm] = useState<TxFormState>(() => defaultForm([]));
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    getAccounts(user.uid).then(setAccounts).catch(() => setAccounts([]));
  }, [user]);

  useEffect(() => {
    if (!form.accountId && accounts[0]?.id) {
      setForm((current) => ({ ...current, accountId: accounts[0].id }));
    }
  }, [accounts, form.accountId]);

  const filtered = useMemo(() => transactions.filter((tx) => {
    const matchesType = filterType === 'all' || tx.type === filterType;
    const query = search.toLowerCase();
    const matchesSearch =
      tx.description.toLowerCase().includes(query) ||
      tx.category.toLowerCase().includes(query) ||
      tx.accountName.toLowerCase().includes(query);
    return matchesType && matchesSearch;
  }), [transactions, filterType, search]);

  const totals = useMemo(() => filtered.reduce(
    (acc, tx) => {
      if (tx.type === 'income') acc.income += tx.amount;
      if (tx.type === 'expense') acc.expense += tx.amount;
      return acc;
    },
    { income: 0, expense: 0 }
  ), [filtered]);

  const accountOptions = useMemo(() => accounts.map((account) => ({ value: account.id, label: account.name })), [accounts]);
  const categoryOptions = useMemo(() => CATEGORIES.map((category) => ({ value: category, label: category })), []);

  const openCreateForm = (type?: TransactionType) => {
    const initialType = type || (filterType === 'income' || filterType === 'expense' ? filterType : 'expense');
    setEditingTx(null);
    setForm(defaultForm(accounts, initialType));
    setFormError('');
    setFormOpen(true);
  };

  const openEditForm = (tx: Transaction) => {
    setEditingTx(tx);
    setForm(formFromTransaction(tx));
    setFormError('');
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setEditingTx(null);
    setFormError('');
  };

  const handleTypeChange = (type: TransactionType) => {
    setForm((current) => ({
      ...current,
      type,
      category: current.category === 'Ingreso' || current.category === 'Otros' ? (type === 'income' ? 'Ingreso' : 'Otros') : current.category,
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;

    const amount = parseMoneyInput(form.amount);
    const account = accounts.find((item) => item.id === form.accountId);
    const description = form.description.trim() || (form.type === 'income' ? 'Ingreso manual' : 'Gasto manual');

    if (amount <= 0) {
      setFormError('Escribe un valor mayor a cero.');
      return;
    }
    if (!account) {
      setFormError('Selecciona una cuenta valida.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const payload = {
        type: form.type,
        amount,
        currency: 'COP' as const,
        category: form.category || (form.type === 'income' ? 'Ingreso' : 'Otros'),
        accountId: account.id,
        accountName: account.name,
        description,
        date: buildDate(form.date, form.time),
        rawText: editingTx ? `Edicion manual: ${description}` : `Registro manual: ${description}`,
        source: 'manual' as const,
        confidence: 1,
      };

      if (editingTx) {
        await updateTransaction(user.uid, editingTx.id, payload as Partial<Transaction>);
      } else {
        await addTransaction(user.uid, payload);
      }

      await refresh();
      setAccounts(await getAccounts(user.uid).catch(() => accounts));
      closeForm();
    } catch (error) {
      console.error(error);
      setFormError('No pude guardar el movimiento. Revisa permisos o intenta otra vez.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    setDeletingId(id);
    try {
      await deleteTransaction(user.uid, id);
      await refresh();
      setAccounts(await getAccounts(user.uid).catch(() => accounts));
    } finally {
      setDeletingId(null);
    }
  };

  const handleExport = () => {
    const base = filterType === 'all' ? transactions : filtered;
    exportTransactionsToExcel(base, 'finanzas-organizadas-ingresos-egresos.xlsx');
  };

  if (loading && transactions.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <section className="lux-hero relative p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="lux-kicker">Ledger visual</p>
            <h1 className="lux-heading mt-2 text-3xl sm:text-4xl">Movimientos</h1>
            <p className="lux-subtle mt-2 max-w-2xl text-sm">Usa el copiloto o registra manualmente ingresos y gastos cuando quieras control total.</p>
          </div>
          <div className="grid gap-3 sm:min-w-[520px] sm:grid-cols-[1fr_1fr_auto]">
            <div className="rounded-3xl border border-green-400/20 bg-green-400/10 p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-green-300">Ingresos</p>
              <p className="mt-1 text-xl font-black text-slate-100">{formatCOP(totals.income)}</p>
            </div>
            <div className="rounded-3xl border border-red-400/20 bg-red-400/10 p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-red-300">Gastos</p>
              <p className="mt-1 text-xl font-black text-slate-100">{formatCOP(totals.expense)}</p>
            </div>
            <Button
              className="h-full min-h-[72px] rounded-3xl"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => openCreateForm()}
            >
              Manual
            </Button>
          </div>
        </div>
      </section>

      <section className="lux-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <SlidersHorizontal className="h-5 w-5 text-blue-300" />
            <p className="text-sm font-black">Filtros inteligentes</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              placeholder="Buscar movimiento, categoria o cuenta..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              icon={<Search className="h-4 w-4" />}
              className="w-full sm:w-80"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openCreateForm('income')}
              icon={<ArrowUpRight className="h-4 w-4" />}
            >
              Ingreso
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openCreateForm('expense')}
              icon={<ArrowDownLeft className="h-4 w-4" />}
            >
              Gasto
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExport}
              disabled={transactions.length === 0}
              icon={<Download className="h-4 w-4" />}
            >
              Excel
            </Button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <Button variant={filterType === 'all' ? 'primary' : 'ghost'} size="sm" onClick={() => setFilterType('all')}>
            Todos
          </Button>
          <Button variant={filterType === 'income' ? 'success' : 'ghost'} size="sm" onClick={() => setFilterType('income')} icon={<ArrowUpRight className="h-4 w-4" />}>
            Ingresos
          </Button>
          <Button variant={filterType === 'expense' ? 'danger' : 'ghost'} size="sm" onClick={() => setFilterType('expense')} icon={<ArrowDownLeft className="h-4 w-4" />}>
            Gastos
          </Button>
        </div>
      </section>

      <section className="premium-panel overflow-hidden rounded-[1.6rem] border border-slate-700/40">
        {filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState
              asset="transactions"
              title={transactions.length === 0 ? 'Aun no hay movimientos' : 'No hay resultados para este filtro'}
              description={transactions.length === 0 ? 'Registra desde el chat, usa el boton Manual o importa un Excel para empezar.' : 'Prueba con otro texto, cuenta o tipo de movimiento.'}
            />
            <div className="mt-4 flex justify-center">
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => openCreateForm()}>
                Crear movimiento manual
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="lux-table w-full min-w-[900px] text-left">
                <thead>
                  <tr className="border-b border-slate-700/40">
                    <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-500">Fecha</th>
                    <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-500">Movimiento</th>
                    <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-500">Categoria</th>
                    <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-500">Cuenta</th>
                    <th className="px-6 py-4 text-right text-xs font-black uppercase tracking-[0.18em] text-slate-500">Valor</th>
                    <th className="px-6 py-4 text-right text-xs font-black uppercase tracking-[0.18em] text-slate-500">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {filtered.map((tx) => (
                    <tr key={tx.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-slate-100">{format(tx.date, 'dd MMM yyyy', { locale: es })}</span>
                          <span className="text-xs text-slate-500">{format(tx.date, 'HH:mm')}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border', tx.source === 'bot' ? 'border-blue-400/25 bg-blue-400/10 text-blue-300' : 'border-slate-600/30 bg-slate-800/40 text-slate-500')}>
                            {tx.source === 'bot' ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                          </span>
                          <span className="max-w-xs truncate text-sm font-bold text-slate-100">{tx.description}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="rounded-full border border-slate-600/30 bg-slate-800/50 px-3 py-1 text-xs font-bold text-slate-300">
                          {tx.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <AccountBrandMark name={tx.accountName} size="sm" showLabel />
                      </td>
                      <td className={clsx('px-6 py-4 whitespace-nowrap text-right text-sm font-black', tx.type === 'income' ? 'text-green-300' : 'text-red-300')}>
                        {tx.type === 'income' ? '+' : '-'}{formatCOP(tx.amount)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => openEditForm(tx)}
                            className="rounded-xl p-2 text-slate-500 transition hover:bg-blue-500/10 hover:text-blue-300"
                            aria-label="Editar movimiento"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(tx.id)}
                            disabled={deletingId === tx.id}
                            className="rounded-xl p-2 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                            aria-label="Eliminar movimiento"
                          >
                            {deletingId === tx.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 p-3 lg:hidden">
              {filtered.map((tx) => (
                <article key={tx.id} className="rounded-3xl border border-slate-700/40 bg-slate-900/35 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <AccountBrandMark name={tx.accountName} size="md" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-100">{tx.description}</p>
                        <p className="mt-1 text-xs text-slate-500">{format(tx.date, 'dd MMM yyyy, HH:mm', { locale: es })}</p>
                      </div>
                    </div>
                    <p className={clsx('shrink-0 text-sm font-black', tx.type === 'income' ? 'text-green-300' : 'text-red-300')}>
                      {tx.type === 'income' ? '+' : '-'}{formatCOP(tx.amount)}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full border border-slate-600/30 bg-slate-800/50 px-3 py-1 text-xs font-bold text-slate-300">
                      <ReceiptText className="h-3.5 w-3.5" />
                      {tx.category}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditForm(tx)}
                        className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-slate-500 transition hover:bg-blue-500/10 hover:text-blue-300"
                      >
                        <Pencil className="h-4 w-4" />
                        Editar
                      </button>
                      <button
                        onClick={() => handleDelete(tx.id)}
                        disabled={deletingId === tx.id}
                        className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
                      >
                        {deletingId === tx.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        Eliminar
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="premium-panel w-full max-w-2xl rounded-[2rem] border border-slate-700/50 p-5 shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between gap-4 border-b border-slate-700/40 pb-4">
              <div>
                <p className="lux-kicker">Modo manual</p>
                <h2 className="mt-1 text-2xl font-black text-slate-100">{editingTx ? 'Editar movimiento' : 'Nuevo movimiento'}</h2>
                <p className="mt-1 text-sm text-slate-400">Registra o corrige datos sin usar el bot.</p>
              </div>
              <button type="button" onClick={closeForm} className="rounded-2xl p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 grid grid-cols-2 gap-3 rounded-3xl border border-slate-700/40 bg-slate-900/35 p-2">
                <button
                  type="button"
                  onClick={() => handleTypeChange('income')}
                  className={clsx('rounded-2xl px-4 py-3 text-sm font-black transition', form.type === 'income' ? 'bg-green-500/20 text-green-200 ring-1 ring-green-400/30' : 'text-slate-400 hover:bg-slate-800/70')}
                >
                  Ingreso
                </button>
                <button
                  type="button"
                  onClick={() => handleTypeChange('expense')}
                  className={clsx('rounded-2xl px-4 py-3 text-sm font-black transition', form.type === 'expense' ? 'bg-red-500/20 text-red-200 ring-1 ring-red-400/30' : 'text-slate-400 hover:bg-slate-800/70')}
                >
                  Gasto
                </button>
              </div>

              <Input
                label="Valor"
                inputMode="numeric"
                placeholder="Ej: 16000"
                value={form.amount}
                onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
              />
              <Select
                label="Cuenta"
                value={form.accountId}
                onChange={(event) => setForm((current) => ({ ...current, accountId: event.target.value }))}
                options={accountOptions.length ? accountOptions : [{ value: '', label: 'Sin cuentas disponibles' }]}
              />
              <Input
                label="Descripcion"
                placeholder="Ej: hamburguesa, sueldo, mercado..."
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                className="sm:col-span-2"
              />
              <Select
                label="Categoria"
                value={form.category}
                onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                options={categoryOptions}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Fecha"
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                />
                <Input
                  label="Hora"
                  type="time"
                  value={form.time}
                  onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))}
                />
              </div>
            </div>

            {formError && (
              <p className="mt-4 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
                {formError}
              </p>
            )}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={closeForm} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" loading={saving} icon={<Save className="h-4 w-4" />}>
                {editingTx ? 'Guardar cambios' : 'Crear movimiento'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
