import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTransactions } from '../hooks/useTransactions';
import { useDebts } from '../hooks/useDebts';
import { getAllTransactions, getBudgets, saveBudgets } from '../lib/firestore';
import { buildMonthlyReport, buildMonthlyTrend, exportFinanceWorkbook } from '../lib/reporting';
import { CATEGORIES, formatCOP } from '../types';
import type { Transaction } from '../types';
import { EmptyState } from '../components/visual/EmptyState';
import { TrendChart } from '../components/visual/TrendChart';
import { AlertTriangle, Check, Download, FileSpreadsheet, Lightbulb, LineChart, Loader2, PieChart, Target, TrendingDown, TrendingUp, WalletCards } from 'lucide-react';

const BUDGET_CATEGORIES = CATEGORIES.filter((c) => c !== 'Ingreso');
const digitsOnly = (value: string): number => { const n = Number(String(value).replace(/[^0-9]/g, '')); return Number.isFinite(n) ? n : 0; };

export function ReportsPage() {
  const { user } = useAuth();
  const { accounts, loading } = useTransactions();
  const { debts, summary: debtSummary } = useDebts();
  // El reporte y el Excel usan el historial COMPLETO; con el listener de 500 el
  // Excel salia incompleto y el "saldo calculado global" quedaba mal.
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const loadAllTransactions = useCallback(async () => {
    if (!user) { setTransactions([]); return; }
    setTransactions(await getAllTransactions(user.uid));
  }, [user]);
  useEffect(() => { loadAllTransactions().catch((error) => console.error('No pude cargar el historial completo para el reporte', error)); }, [loadAllTransactions]);
  const report = useMemo(() => buildMonthlyReport(transactions, debts), [transactions, debts]);
  const categories = Object.entries(report.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const trend = useMemo(() => buildMonthlyTrend(transactions, 6), [transactions]);

  // Presupuestos por categoria (solo AVISO). draft = lo que se esta editando.
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingBudgets, setSavingBudgets] = useState(false);
  const [budgetMsg, setBudgetMsg] = useState('');
  useEffect(() => {
    if (!user) return;
    getBudgets(user.uid).then((b) => {
      setBudgets(b);
      setDraft(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, String(v)])));
    }).catch((error) => console.error('No pude cargar presupuestos', error));
  }, [user]);

  const handleSaveBudgets = async () => {
    if (!user) return;
    setSavingBudgets(true);
    setBudgetMsg('');
    try {
      const next: Record<string, number> = {};
      for (const cat of BUDGET_CATEGORIES) { const n = digitsOnly(draft[cat] || ''); if (n > 0) next[cat] = n; }
      await saveBudgets(user.uid, next);
      setBudgets(next);
      setBudgetMsg('Presupuestos guardados.');
    } catch (error: any) {
      setBudgetMsg(error?.message || 'No pude guardar los presupuestos.');
    } finally {
      setSavingBudgets(false);
    }
  };

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

      <section className="lux-card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-slate-100">
          <LineChart className="h-5 w-5 text-blue-300" />
          Tendencia (últimos 6 meses)
        </h2>
        {transactions.length ? (
          <TrendChart points={trend} />
        ) : (
          <EmptyState asset="reports" title="Aún no hay historial para la tendencia" description="Registra o importa movimientos y aquí verás cómo evolucionan tus ingresos y gastos mes a mes." />
        )}
      </section>

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

      <section className="lux-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <Target className="h-5 w-5 text-blue-300" />
          <h2 className="text-lg font-black text-slate-100">Presupuesto por categoría</h2>
        </div>
        <p className="mb-5 text-xs text-slate-500">Es solo un <span className="font-bold text-slate-300">aviso</span>, no un límite: nunca te bloquea gastar. Si te pasas, el copiloto te avisa con cariño. Deja en blanco para no vigilar una categoría.</p>

        <div className="grid gap-3 sm:grid-cols-2">
          {BUDGET_CATEGORIES.map((cat) => {
            const spent = report.byCategory[cat] || 0;
            const budget = budgets[cat] || 0;
            const pct = budget > 0 ? (spent / budget) * 100 : 0;
            const over = budget > 0 && spent > budget;
            const near = budget > 0 && !over && pct >= 80;
            const barColor = over ? 'bg-red-400' : near ? 'bg-amber-300' : 'bg-green-400';
            return (
              <div key={cat} className="rounded-2xl border border-slate-700/40 bg-slate-900/35 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-black text-slate-100">{cat}</span>
                  {over && <span className="shrink-0 rounded-full border border-red-400/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-black text-red-200">Te pasaste {formatCOP(spent - budget)}</span>}
                  {near && <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/15 px-2 py-0.5 text-[10px] font-black text-amber-200">Cerca del tope</span>}
                </div>
                <p className="mt-1 text-xs text-slate-400">Este mes: <span className="font-bold text-slate-200">{formatCOP(spent)}</span>{budget > 0 && <> de <span className="font-bold text-slate-200">{formatCOP(budget)}</span></>}</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800/70">
                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${budget > 0 ? Math.min(100, pct) : 0}%` }} />
                </div>
                <label className="mt-3 flex items-center gap-2">
                  <span className="text-[11px] font-black text-slate-500">Tope mensual</span>
                  <input
                    inputMode="numeric"
                    value={draft[cat] ?? ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [cat]: e.target.value }))}
                    placeholder="sin tope"
                    className="lux-input w-full rounded-xl px-3 py-2 text-sm outline-none"
                  />
                </label>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button onClick={handleSaveBudgets} disabled={savingBudgets} className="premium-button inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-black transition disabled:opacity-50">
            {savingBudgets ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Guardar presupuestos
          </button>
          {budgetMsg && <span className="text-sm font-bold text-blue-200">{budgetMsg}</span>}
        </div>
      </section>
    </div>
  );
}
