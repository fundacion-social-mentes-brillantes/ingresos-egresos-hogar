import { useTransactions, useFinancialSummary, useLast7Days } from '../hooks/useTransactions';
import { StatCard } from '../components/ui/Card';
import { formatCOP } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useDebts } from '../hooks/useDebts';
import { ChatPage } from './ChatPage';
import {
  TrendingUp, TrendingDown, Wallet, Activity,
  Tag, Calendar, Loader2, Info, HandCoins, AlertTriangle
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export function DashboardPage() {
  const { user } = useAuth();
  const { transactions, loading } = useTransactions();
  const summary   = useFinancialSummary(transactions);
  const last7     = useLast7Days(transactions);
  const { debts, summary: debtSummary } = useDebts();
  const last7Total = last7.reduce((s, t) => s + t.amount, 0);

  const topCategory = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1])[0];
  const expenseBars = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const openDebts = debts.filter((debt) => debt.status !== 'paid').slice(0, 4);
  const today = format(new Date(), "EEEE d 'de' MMMM", { locale: es });

  if (loading && transactions.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pb-8">
      {/* LEFT COLUMN: CHAT (PROTAGONIST) */}
      <div className="lg:col-span-7 xl:col-span-8 flex flex-col h-[600px] lg:h-[calc(100vh-8rem)]">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-slate-100">
            Hola, {user?.displayName?.split(' ')[0]} 👋
          </h1>
          <p className="text-slate-400 text-sm capitalize">{today}</p>
        </div>
        
        <div className="flex-1 glass rounded-3xl overflow-hidden border border-slate-700/40 flex flex-col shadow-2xl shadow-blue-500/5">
          <ChatPage embedded={true} />
        </div>
      </div>

      {/* RIGHT COLUMN: STATS & SUMMARY */}
      <div className="lg:col-span-5 xl:col-span-4 space-y-6 overflow-y-auto lg:h-[calc(100vh-8rem)] pr-1 custom-scrollbar">
        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            label="Balance"
            value={formatCOP(summary.balance)}
            icon={<Wallet className="w-4 h-4" />}
            color={summary.balance >= 0 ? 'blue' : 'red'}
          />
          <StatCard
            label="7 días"
            value={formatCOP(last7Total)}
            icon={<Activity className="w-4 h-4" />}
            color="amber"
          />
        </div>

        {/* Debt cards */}
        <div className="grid grid-cols-2 gap-4">
          <div className="glass rounded-2xl p-4 border border-green-500/20 bg-green-500/5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-green-400 uppercase tracking-wider">Te deben</span>
              <HandCoins className="w-4 h-4 text-green-400" />
            </div>
            <p className="text-lg font-bold text-slate-100">{formatCOP(debtSummary.receivable)}</p>
          </div>
          <div className="glass rounded-2xl p-4 border border-red-500/20 bg-red-500/5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-red-400 uppercase tracking-wider">Debes</span>
              <AlertTriangle className="w-4 h-4 text-red-400" />
            </div>
            <p className="text-lg font-bold text-slate-100">{formatCOP(debtSummary.payable)}</p>
          </div>
        </div>

        {/* Income/Expense Cards */}
        <div className="grid grid-cols-1 gap-4">
          <div className="glass rounded-2xl p-4 border border-green-500/20 bg-green-500/5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-green-400 uppercase tracking-wider">Ingresos Mes</span>
              <TrendingUp className="w-4 h-4 text-green-400" />
            </div>
            <p className="text-xl font-bold text-slate-100">{formatCOP(summary.totalIncome)}</p>
          </div>
          
          <div className="glass rounded-2xl p-4 border border-red-500/20 bg-red-500/5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-red-400 uppercase tracking-wider">Gastos Mes</span>
              <TrendingDown className="w-4 h-4 text-red-400" />
            </div>
            <p className="text-xl font-bold text-slate-100">{formatCOP(summary.totalExpenses)}</p>
          </div>
        </div>

        {/* Category bars */}
        <div className="glass rounded-2xl p-5 border border-slate-700/30">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-300">Gastos por categoría</h2>
          </div>
          {expenseBars.length > 0 ? (
            <div className="space-y-3">
              {expenseBars.map(([category, amount]) => (
                <div key={category}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-300 truncate">{category}</span>
                    <span className="text-slate-400">{formatCOP(amount)}</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-red-500 to-amber-400 rounded-full" style={{ width: `${summary.totalExpenses > 0 ? Math.min(100, (amount / summary.totalExpenses) * 100) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-xs italic">Aún no hay categorías. Escribe un gasto en el chat y aquí aparecerá el análisis.</p>
          )}
        </div>

        {/* Top Category */}
        <div className="glass rounded-2xl p-5 border border-slate-700/30">
          <div className="flex items-center gap-2 mb-4">
            <Tag className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-300">Mayor gasto</h2>
          </div>
          {topCategory ? (
            <div>
              <p className="text-lg font-bold text-slate-100">{topCategory[0]}</p>
              <p className="text-blue-400 font-semibold mt-0.5">{formatCOP(topCategory[1])}</p>
              <div className="mt-3 bg-slate-700/30 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full"
                  style={{
                    width: summary.totalExpenses > 0
                      ? `${Math.min(100, (topCategory[1] / summary.totalExpenses) * 100)}%`
                      : '0%'
                  }}
                />
              </div>
            </div>
          ) : (
            <p className="text-slate-500 text-xs italic">Sin gastos registrados</p>
          )}
        </div>

        {/* Open debts */}
        <div className="glass rounded-2xl p-5 border border-slate-700/30">
          <div className="flex items-center gap-2 mb-4">
            <HandCoins className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-300">Deudas pendientes</h2>
          </div>
          {openDebts.length > 0 ? (
            <ul className="space-y-3">
              {openDebts.map((debt) => {
                const remaining = Math.max(0, debt.amountOriginal - debt.amountPaid);
                return (
                  <li key={debt.id} className="flex items-center justify-between gap-2 border-b border-slate-700/30 pb-2 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200 truncate font-medium">{debt.personName}</p>
                      <p className="text-[10px] text-slate-500 uppercase">{debt.direction === 'receivable' ? 'Te debe' : 'Tú debes'}</p>
                    </div>
                    <span className={debt.direction === 'receivable' ? 'text-green-400 text-sm font-bold shrink-0' : 'text-red-400 text-sm font-bold shrink-0'}>{formatCOP(remaining)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-slate-500 text-xs text-center py-2 italic">Sin deudas pendientes. Puedes decir: “Juan me debe 50 mil”.</p>
          )}
        </div>

        {/* Mini History */}
        <div className="glass rounded-2xl p-5 border border-slate-700/30">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-semibold text-slate-300">Últimos movimientos</h2>
            </div>
          </div>
          <ul className="space-y-3">
            {transactions.slice(0, 4).map(tx => (
              <li key={tx.id} className="flex items-center justify-between gap-2 border-b border-slate-700/30 pb-2 last:border-0 last:pb-0">
                <div className="flex flex-col min-w-0">
                  <span className="text-sm text-slate-200 truncate font-medium">{tx.description}</span>
                  <span className="text-[10px] text-slate-500 uppercase">{tx.category}</span>
                </div>
                <span className={`text-sm font-bold shrink-0 ${
                  tx.type === 'income' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {tx.type === 'income' ? '+' : '-'}{formatCOP(tx.amount)}
                </span>
              </li>
            ))}
            {transactions.length === 0 && (
              <p className="text-slate-500 text-xs text-center py-2 italic">Empieza a hablar con el bot para ver tus movimientos aquí.</p>
            )}
          </ul>
        </div>
        
        {/* Tip/Info */}
        <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex gap-3 items-start">
          <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-200/70 leading-relaxed">
            Puedes preguntarme cosas como "analiza mis fugas", "quién me debe", "corrige ese gasto a 80 mil" o "descargar Excel".
          </p>
        </div>
      </div>
    </div>
  );
}
