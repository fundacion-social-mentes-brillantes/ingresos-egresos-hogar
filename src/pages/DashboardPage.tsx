import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTransactions, useFinancialSummary, useLast7Days } from '../hooks/useTransactions';
import { getTransactionsByRange } from '../lib/firestore';
import { isExternalAccount, personalTransactions } from '../lib/accounting';
import { StatCard } from '../components/ui/Card';
import { formatCOP } from '../types';
import type { Transaction } from '../types';
import { useUserProfile } from '../hooks/useUserProfile';
import { useDebts } from '../hooks/useDebts';
import { ChatPage } from './ChatPagePro';
import { AccountBrandMark } from '../components/visual/AccountBrandMark';
import { EmptyState } from '../components/visual/EmptyState';
import {
  TrendingUp, TrendingDown, Wallet, Activity,
  Tag, Calendar, Loader2, Info, HandCoins, AlertTriangle, Sparkles, ArrowUpRight
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfDay, subDays } from 'date-fns';
import { es } from 'date-fns/locale';

export function DashboardPage() {
  const { user } = useAuth();
  const { displayName } = useUserProfile();
  const { transactions, accounts, loading } = useTransactions();
  // El resumen del mes y los ultimos 7 dias se calculan sobre una consulta
  // acotada por fecha (completa), no sobre el listener truncado a 500: con mas
  // de 500 movimientos historicos el balance del mes salia incompleto.
  const [periodTx, setPeriodTx] = useState<Transaction[]>([]);
  useEffect(() => {
    if (!user) { setPeriodTx([]); return; }
    const now = new Date();
    const monthStart = startOfMonth(now);
    const last7Start = subDays(startOfDay(now), 6);
    const start = monthStart.getTime() < last7Start.getTime() ? monthStart : last7Start;
    getTransactionsByRange(user.uid, start, endOfMonth(now))
      .then(setPeriodTx)
      .catch((error) => console.error('No pude cargar el periodo para el dashboard', error));
  }, [user]);
  // Excluye movimientos de cuentas ajenas (dinero de terceros) de los totales.
  const personalPeriodTx = useMemo(() => personalTransactions(periodTx, accounts), [periodTx, accounts]);
  const summary = useFinancialSummary(personalPeriodTx);
  const last7 = useLast7Days(personalPeriodTx);
  const { debts, summary: debtSummary } = useDebts();
  const last7Total = last7.reduce((sum, tx) => sum + tx.amount, 0);
  const personalRecent = useMemo(() => personalTransactions(transactions, accounts), [transactions, accounts]);

  const topCategory = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1])[0];
  const expenseBars = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const openDebts = debts.filter((debt) => debt.status !== 'paid' && !debt.isReversed).slice(0, 4);
  const accountPreview = accounts.filter((account) => account.active && !isExternalAccount(account)).slice(0, 4);
  const firstName = displayName.split(' ')[0] || 'Usuario';
  const today = format(new Date(), "EEEE d 'de' MMMM", { locale: es });

  if (loading && transactions.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="grid min-h-[calc(100dvh-2rem)] grid-cols-1 gap-5 pb-6 lg:grid-cols-12 lg:items-start">
      <div className="dashboard-chat-column flex flex-col lg:col-span-8 lg:h-[calc(100dvh-3rem)] xl:col-span-8">
        <section className="lux-hero relative mb-3 shrink-0 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="lux-kicker">Centro financiero familiar</p>
              <h1 className="lux-heading mt-1 text-2xl sm:text-3xl">Hola, {firstName}</h1>
              <p className="lux-subtle mt-1 text-sm capitalize">{today}</p>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-2xl border border-blue-400/25 bg-blue-400/10 px-4 py-2.5 text-sm font-bold text-blue-100">
              <Sparkles className="h-4 w-4 text-cyan-300" />
              Copiloto activo
            </div>
          </div>
        </section>

        <div className="dashboard-chat-panel premium-panel flex flex-col overflow-hidden rounded-[1.75rem] border border-slate-700/40">
          <ChatPage embedded />
        </div>
      </div>

      <aside className="custom-scrollbar space-y-4 overflow-y-auto pr-1 lg:col-span-4 lg:h-[calc(100dvh-3rem)] xl:col-span-4">
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            label="Balance"
            value={formatCOP(summary.balance)}
            icon={<Wallet className="h-4 w-4" />}
            color={summary.balance >= 0 ? 'blue' : 'red'}
            sub="Mes actual"
          />
          <StatCard
            label="7 dias"
            value={formatCOP(last7Total)}
            icon={<Activity className="h-4 w-4" />}
            color="amber"
            sub="Gasto reciente"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="metric-card border-green-500/20 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-green-300">Te deben</span>
              <HandCoins className="h-4 w-4 text-green-300" />
            </div>
            <p className="text-xl font-black text-slate-100">{formatCOP(debtSummary.receivable)}</p>
          </div>
          <div className="metric-card border-red-500/20 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-red-300">Debes</span>
              <AlertTriangle className="h-4 w-4 text-red-300" />
            </div>
            <p className="text-xl font-black text-slate-100">{formatCOP(debtSummary.payable)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div className="metric-card border-green-500/20 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-green-300">Ingresos mes</span>
              <TrendingUp className="h-4 w-4 text-green-300" />
            </div>
            <p className="text-2xl font-black text-slate-100">{formatCOP(summary.totalIncome)}</p>
          </div>
          <div className="metric-card border-red-500/20 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-red-300">Gastos mes</span>
              <TrendingDown className="h-4 w-4 text-red-300" />
            </div>
            <p className="text-2xl font-black text-slate-100">{formatCOP(summary.totalExpenses)}</p>
          </div>
        </div>

        <section className="lux-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-blue-300" />
              <h2 className="text-sm font-black text-slate-100">Cuentas</h2>
            </div>
            <span className="text-xs font-bold text-slate-500">{accountPreview.length} activas</span>
          </div>
          {accountPreview.length > 0 ? (
            <div className="space-y-3">
              {accountPreview.map((account) => (
                <div key={account.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-700/40 bg-slate-900/35 p-3">
                  <AccountBrandMark type={account.type} name={account.name} size="sm" showLabel />
                  <p className="shrink-0 text-sm font-black text-blue-200">{formatCOP(account.currentBalance)}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState asset="categories" title="Sin cuentas visibles" description="Cuando tengas cuentas activas, apareceran aqui con su identidad visual." className="min-h-44 p-4" />
          )}
        </section>

        <section className="lux-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-300" />
            <h2 className="text-sm font-black text-slate-100">Gastos por categoria</h2>
          </div>
          {expenseBars.length > 0 ? (
            <div className="space-y-4">
              {expenseBars.map(([category, amount]) => (
                <div key={category}>
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-bold text-slate-300">{category}</span>
                    <span className="font-black text-slate-100">{formatCOP(amount)}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-800/70">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-red-400 via-amber-300 to-blue-400"
                      style={{ width: `${summary.totalExpenses > 0 ? Math.min(100, (amount / summary.totalExpenses) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState asset="categories" title="Aun sin categorias" description="Registra un gasto desde el chat y esta zona se convertira en lectura visual de tus habitos." className="min-h-48 p-5" />
          )}
        </section>

        <section className="lux-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Tag className="h-4 w-4 text-blue-300" />
            <h2 className="text-sm font-black text-slate-100">Mayor gasto</h2>
          </div>
          {topCategory ? (
            <div>
              <p className="text-2xl font-black text-slate-100">{topCategory[0]}</p>
              <p className="mt-1 font-black text-blue-300">{formatCOP(topCategory[1])}</p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800/70">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-400 to-violet-400"
                  style={{ width: summary.totalExpenses > 0 ? `${Math.min(100, (topCategory[1] / summary.totalExpenses) * 100)}%` : '0%' }}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Sin gastos registrados todavia.</p>
          )}
        </section>

        <section className="lux-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <HandCoins className="h-4 w-4 text-blue-300" />
            <h2 className="text-sm font-black text-slate-100">Deudas pendientes</h2>
          </div>
          {openDebts.length > 0 ? (
            <ul className="space-y-3">
              {openDebts.map((debt) => {
                const remaining = Math.max(0, debt.amountOriginal - debt.amountPaid);
                return (
                  <li key={debt.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-700/40 bg-slate-900/35 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-100">{debt.personName}</p>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{debt.direction === 'receivable' ? 'Te debe' : 'Tu debes'}</p>
                    </div>
                    <span className={debt.direction === 'receivable' ? 'shrink-0 text-sm font-black text-green-300' : 'shrink-0 text-sm font-black text-red-300'}>{formatCOP(remaining)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState asset="debts" title="Sin deudas abiertas" description="Puedes decirle al copiloto: Juan me debe 50 mil, y lo deja ordenado." className="min-h-48 p-5" />
          )}
        </section>

        <section className="lux-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-300" />
              <h2 className="text-sm font-black text-slate-100">Ultimos movimientos</h2>
            </div>
            <ArrowUpRight className="h-4 w-4 text-slate-500" />
          </div>
          {personalRecent.length > 0 ? (
            <ul className="space-y-3">
              {personalRecent.slice(0, 4).map((tx) => (
                <li key={tx.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-700/40 bg-slate-900/35 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <AccountBrandMark name={tx.accountName} size="sm" />
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-bold text-slate-100">{tx.description}</span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{tx.category}</span>
                    </div>
                  </div>
                  <span className={`shrink-0 text-sm font-black ${tx.type === 'income' ? 'text-green-300' : 'text-red-300'}`}>
                    {tx.type === 'income' ? '+' : '-'}{formatCOP(tx.amount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState asset="transactions" title="Sin movimientos aun" description="Habla con el copiloto para registrar el primer ingreso o gasto." className="min-h-48 p-5" />
          )}
        </section>

        <div className="flex items-start gap-3 rounded-3xl border border-blue-500/20 bg-blue-500/10 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" />
          <p className="text-xs leading-relaxed text-blue-100/80">
            Prueba: "analiza mis fugas", "quien me debe", "corrige ese gasto a 80 mil" o "descargar Excel".
          </p>
        </div>
      </aside>
    </div>
  );
}
