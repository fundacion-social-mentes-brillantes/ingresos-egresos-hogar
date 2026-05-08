import { useMemo } from 'react';
import { useTransactions } from '../hooks/useTransactions';
import { useDebts } from '../hooks/useDebts';
import { buildMonthlyReport, exportFinanceWorkbook } from '../lib/reporting';
import { formatCOP } from '../types';
import { AlertTriangle, Download, FileSpreadsheet, Lightbulb, PieChart, TrendingDown, TrendingUp } from 'lucide-react';

export function ReportsPage() {
  const { transactions, accounts, loading } = useTransactions();
  const { debts, summary: debtSummary } = useDebts();
  const report = useMemo(() => buildMonthlyReport(transactions, debts), [transactions, debts]);
  const categories = Object.entries(report.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const exportReport = () => exportFinanceWorkbook({ transactions, debts, accounts, fileName: 'reporte-mensual-ingresos-egresos.xlsx' });

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-10">
      <div className="glass rounded-3xl border border-slate-700/40 p-5 sm:p-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-400">Reportes profesionales</p>
            <h1 className="mt-2 text-2xl font-black text-slate-100 sm:text-3xl">Cierre financiero del mes</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Resumen, fugas, deudas, oportunidades y exportación lista para Excel.</p>
          </div>
          <button onClick={exportReport} disabled={loading || transactions.length === 0} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-500 disabled:opacity-50">
            <Download className="h-4 w-4" /> Descargar reporte Excel
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="glass rounded-2xl p-5"><TrendingUp className="mb-3 h-5 w-5 text-green-400" /><p className="text-xs uppercase text-slate-500">Ingresos</p><p className="text-2xl font-black text-slate-100">{formatCOP(report.totalIncome)}</p></div>
        <div className="glass rounded-2xl p-5"><TrendingDown className="mb-3 h-5 w-5 text-red-400" /><p className="text-xs uppercase text-slate-500">Gastos</p><p className="text-2xl font-black text-slate-100">{formatCOP(report.totalExpenses)}</p></div>
        <div className="glass rounded-2xl p-5"><PieChart className="mb-3 h-5 w-5 text-blue-400" /><p className="text-xs uppercase text-slate-500">Balance</p><p className={report.balance >= 0 ? 'text-2xl font-black text-blue-300' : 'text-2xl font-black text-red-300'}>{formatCOP(report.balance)}</p></div>
        <div className="glass rounded-2xl p-5"><FileSpreadsheet className="mb-3 h-5 w-5 text-amber-400" /><p className="text-xs uppercase text-slate-500">Ahorro estimado</p><p className="text-2xl font-black text-slate-100">{report.savingsRate.toFixed(1)}%</p></div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="glass rounded-3xl border border-slate-700/40 p-5">
          <h2 className="mb-4 flex items-center gap-2 font-bold text-slate-100"><PieChart className="h-5 w-5 text-blue-400" /> Gastos por categoría</h2>
          {categories.length ? <div className="space-y-4">{categories.map(([category, amount]) => (
            <div key={category}>
              <div className="mb-1 flex justify-between text-sm"><span className="text-slate-300">{category}</span><span className="font-bold text-slate-100">{formatCOP(amount)}</span></div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-red-500 to-amber-400" style={{ width: `${report.totalExpenses ? Math.min(100, amount / report.totalExpenses * 100) : 0}%` }} /></div>
            </div>
          ))}</div> : <div className="rounded-3xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">Aún no hay gastos del mes. Registra algunos desde el chat para ver el análisis.</div>}
        </div>

        <div className="space-y-5">
          <div className="glass rounded-3xl border border-slate-700/40 p-5">
            <h2 className="mb-3 flex items-center gap-2 font-bold text-slate-100"><AlertTriangle className="h-5 w-5 text-amber-400" /> Alertas</h2>
            <div className="space-y-2">{report.alerts.length ? report.alerts.map((alert) => <p key={alert} className="rounded-2xl bg-amber-500/10 p-3 text-sm text-amber-100">{alert}</p>) : <p className="text-sm text-slate-500">Sin alertas fuertes por ahora.</p>}</div>
          </div>
          <div className="glass rounded-3xl border border-slate-700/40 p-5">
            <h2 className="mb-3 flex items-center gap-2 font-bold text-slate-100"><Lightbulb className="h-5 w-5 text-green-400" /> Oportunidades</h2>
            <div className="space-y-2">{report.opportunities.map((item) => <p key={item} className="rounded-2xl bg-green-500/10 p-3 text-sm text-green-100">{item}</p>)}</div>
          </div>
          <div className="glass rounded-3xl border border-slate-700/40 p-5">
            <h2 className="mb-3 font-bold text-slate-100">Deudas</h2>
            <p className="text-sm text-green-300">Te deben: {formatCOP(debtSummary.receivable)}</p>
            <p className="mt-1 text-sm text-red-300">Tú debes: {formatCOP(debtSummary.payable)}</p>
            <p className="mt-2 text-xs text-slate-500">Balance neto de deudas: {formatCOP(debtSummary.net)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
