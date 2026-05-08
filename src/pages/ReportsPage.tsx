import { useMemo } from 'react';
import { useTransactions } from '../hooks/useTransactions';
import { useDebts } from '../hooks/useDebts';
import { buildMonthlyReport, exportFinanceWorkbook } from '../lib/reporting';
import { formatCOP } from '../types';
import { EmptyState } from '../components/visual/EmptyState';
import { AlertTriangle, Download, FileSpreadsheet, Lightbulb, PieChart, TrendingDown, TrendingUp, WalletCards } from 'lucide-react';

export function ReportsPage() {
  const { transactions, accounts, loading } = useTransactions();
  const { debts, summary: debtSummary } = useDebts();
  const report = useMemo(() => buildMonthlyReport(transactions, debts), [transactions, debts]);
  const categories = Object.entries(report.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const exportReport = () => exportFinanceWorkbook({ transactions, debts, accounts, fileName: 'reporte-mensual-ingresos-egresos.xlsx' });

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 pb-10">
      <section className="lux-hero relative p-5 sm:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="lux-kicker">Inteligencia financiera</p>
            <h1 className="lux-heading mt-2 text-3xl sm:text-4xl">Cierre financiero del mes</h1>
            <p className="lux-subtle mt-2 max-w-2xl text-sm">Resumen, fugas, deudas, oportunidades y exportacion lista para Excel.</p>
          </div>
          <button onClick={exportReport} disabled={loading || transactions.length === 0} className="premium-button inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-black transition disabled:opacity-50">
            <Download className="h-4 w-4" />
            Descargar Excel
          </button>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="metric-card p-5">
          <TrendingUp className="mb-4 h-6 w-6 text-green-300" />
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Ingresos</p>
          <p className="mt-2 text-2xl font-black text-slate-100">{formatCOP(report.totalIncome)}</p>
        </div>
        <div className="metric-card p-5">
          <TrendingDown className="mb-4 h-6 w-6 text-red-300" />
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Gastos</p>
          <p className="mt-2 text-2xl font-black text-slate-100">{formatCOP(report.totalExpenses)}</p>
        </div>
        <div className="metric-card p-5">
          <PieChart className="mb-4 h-6 w-6 text-blue-300" />
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Balance</p>
          <p className={report.balance >= 0 ? 'mt-2 text-2xl font-black text-blue-300' : 'mt-2 text-2xl font-black text-red-300'}>{formatCOP(report.balance)}</p>
        </div>
        <div className="metric-card p-5">
          <FileSpreadsheet className="mb-4 h-6 w-6 text-amber-300" />
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Ahorro estimado</p>
          <p className="mt-2 text-2xl font-black text-slate-100">{report.savingsRate.toFixed(1)}%</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.18fr_0.82fr]">
        <section className="lux-card p-5">
          <h2 className="mb-5 flex items-center gap-2 text-lg font-black text-slate-100">
            <PieChart className="h-5 w-5 text-blue-300" />
            Gastos por categoria
          </h2>
          {categories.length ? (
            <div className="space-y-5">
              {categories.map(([category, amount], index) => (
                <div key={category} className="rounded-3xl border border-slate-700/40 bg-slate-900/35 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-400/10 text-xs font-black text-blue-200">
                        {index + 1}
                      </span>
                      <span className="truncate text-sm font-black text-slate-100">{category}</span>
                    </div>
                    <span className="shrink-0 text-sm font-black text-slate-100">{formatCOP(amount)}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-800/70">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-red-400 via-amber-300 to-blue-400"
                      style={{ width: `${report.totalExpenses ? Math.min(100, (amount / report.totalExpenses) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState asset="reports" title="Aun no hay datos para graficar" description="Registra gastos desde el chat o importa movimientos para activar este centro de inteligencia." />
          )}
        </section>

        <aside className="space-y-5">
          <section className="lux-card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-slate-100">
              <AlertTriangle className="h-5 w-5 text-amber-300" />
              Alertas
            </h2>
            <div className="space-y-3">
              {report.alerts.length ? report.alerts.map((alert) => (
                <p key={alert} className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm leading-relaxed text-amber-100">{alert}</p>
              )) : (
                <p className="rounded-2xl border border-slate-700/40 bg-slate-900/35 p-4 text-sm text-slate-500">Sin alertas fuertes por ahora.</p>
              )}
            </div>
          </section>

          <section className="lux-card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-slate-100">
              <Lightbulb className="h-5 w-5 text-green-300" />
              Oportunidades
            </h2>
            <div className="space-y-3">
              {report.opportunities.map((item) => (
                <p key={item} className="rounded-2xl border border-green-400/20 bg-green-400/10 p-3 text-sm leading-relaxed text-green-100">{item}</p>
              ))}
            </div>
          </section>

          <section className="lux-card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-slate-100">
              <WalletCards className="h-5 w-5 text-blue-300" />
              Deudas
            </h2>
            <div className="grid gap-3">
              <div className="rounded-2xl border border-green-400/20 bg-green-400/10 p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-green-300">Te deben</p>
                <p className="mt-1 text-lg font-black text-slate-100">{formatCOP(debtSummary.receivable)}</p>
              </div>
              <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-red-300">Tu debes</p>
                <p className="mt-1 text-lg font-black text-slate-100">{formatCOP(debtSummary.payable)}</p>
              </div>
              <p className="rounded-2xl border border-blue-400/20 bg-blue-400/10 p-4 text-sm font-bold text-blue-100">
                Balance neto de deudas: {formatCOP(debtSummary.net)}
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
