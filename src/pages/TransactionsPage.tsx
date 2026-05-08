import { useMemo, useState } from 'react';
import { useTransactions } from '../hooks/useTransactions';
import { deleteTransaction } from '../lib/firestore';
import { exportTransactionsToExcel } from '../lib/exportExcel';
import { useAuth } from '../contexts/AuthContext';
import { formatCOP } from '../types';
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
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { AccountBrandMark } from '../components/visual/AccountBrandMark';
import { EmptyState } from '../components/visual/EmptyState';
import clsx from 'clsx';

export function TransactionsPage() {
  const { user } = useAuth();
  const { transactions, loading, refresh } = useTransactions();
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const handleDelete = async (id: string) => {
    if (!user) return;
    setDeletingId(id);
    try {
      await deleteTransaction(user.uid, id);
      await refresh();
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
            <p className="lux-subtle mt-2 max-w-2xl text-sm">Historial completo con lectura rapida por tipo, cuenta, categoria y origen.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:min-w-[360px]">
            <div className="rounded-3xl border border-green-400/20 bg-green-400/10 p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-green-300">Ingresos</p>
              <p className="mt-1 text-xl font-black text-slate-100">{formatCOP(totals.income)}</p>
            </div>
            <div className="rounded-3xl border border-red-400/20 bg-red-400/10 p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-red-300">Gastos</p>
              <p className="mt-1 text-xl font-black text-slate-100">{formatCOP(totals.expense)}</p>
            </div>
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
              description={transactions.length === 0 ? 'Registra desde el chat o importa un Excel para empezar a ver tu historial financiero.' : 'Prueba con otro texto, cuenta o tipo de movimiento.'}
            />
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="lux-table w-full min-w-[860px] text-left">
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
                        <button
                          onClick={() => handleDelete(tx.id)}
                          disabled={deletingId === tx.id}
                          className="rounded-xl p-2 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                          aria-label="Eliminar movimiento"
                        >
                          {deletingId === tx.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
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
                    <button
                      onClick={() => handleDelete(tx.id)}
                      disabled={deletingId === tx.id}
                      className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
                    >
                      {deletingId === tx.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Eliminar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
