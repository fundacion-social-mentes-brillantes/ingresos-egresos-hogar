import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { differenceInCalendarDays, endOfMonth, startOfDay, startOfMonth, subDays } from 'date-fns';
import { AlertTriangle, CalendarClock, PiggyBank, Sparkles, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTransactions } from '../../hooks/useTransactions';
import { useDebts } from '../../hooks/useDebts';
import { getBudgets } from '../../lib/firestore';
import { isReportableFinancialTransaction, personalTransactions, toMoney } from '../../lib/accounting';
import { formatCOP } from '../../types';

// Gastos "de gustos" (potencialmente innecesarios). Necesidades como Hogar,
// Salud, Educacion, Transporte, Alimentacion y Ahorro NO cuentan aqui.
const DISCRETIONARY = new Set(['Entretenimiento', 'Ropa', 'Tecnología', 'Tecnologia']);
const DISMISS_KEY = 'nudgeDismissed';

type NudgeType = 'debt' | 'budget' | 'spend';
interface Nudge { type: NudgeType; tone: 'red' | 'amber'; message: string; }

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Aviso proactivo y AMABLE (nunca regaña ni bloquea): pantallita emergente que
// prioriza (1) deudas por vencer, (2) presupuesto excedido del mes, (3) muchos
// gastos de gustos en la semana. Todo se calcula en el cliente (sin gastar la
// IA) y cada tipo de aviso se puede cerrar por hoy.
export function SpendingNudge() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { transactions: allTransactions, accounts, loading } = useTransactions();
  // Los avisos son sobre el gasto PERSONAL: excluimos cuentas ajenas.
  const transactions = useMemo(() => personalTransactions(allTransactions, accounts), [allTransactions, accounts]);
  const { debts } = useDebts();
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [dismissed, setDismissed] = useState<Set<NudgeType>>(new Set());

  useEffect(() => {
    if (!user) { setBudgets({}); return; }
    getBudgets(user.uid).then(setBudgets).catch(() => setBudgets({}));
  }, [user]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.day === todayKey() && Array.isArray(parsed.types)) setDismissed(new Set(parsed.types));
      else setDismissed(new Set());
    } catch { setDismissed(new Set()); }
  }, []);

  const nudge = useMemo<Nudge | null>(() => {
    const now = new Date();

    // 1) Deuda por vencer o vencida (lo mas urgente).
    const debtSoon = debts
      .filter((d) => d.status !== 'paid' && !d.isReversed && d.dueDate instanceof Date)
      .map((d) => ({ d, days: differenceInCalendarDays(d.dueDate as Date, startOfDay(now)), rest: Math.max(0, toMoney(d.amountOriginal) - toMoney(d.amountPaid)) }))
      .filter((x) => x.rest > 0 && x.days <= 5)
      .sort((a, b) => a.days - b.days);
    if (debtSoon.length) {
      const { d, days, rest } = debtSoon[0];
      const who = d.personName || 'alguien';
      const plural = Math.abs(days) === 1 ? '' : 's';
      let message: string;
      if (d.direction === 'payable') {
        message = days < 0 ? `Se pasó la fecha de tu deuda con ${who}: debes ${formatCOP(rest)}.`
          : days === 0 ? `Hoy vence tu deuda con ${who}: ${formatCOP(rest)}.`
          : `Tu deuda con ${who} (${formatCOP(rest)}) vence en ${days} día${plural}.`;
      } else {
        message = days < 0 ? `Se pasó la fecha en que ${who} debía pagarte ${formatCOP(rest)}.`
          : days === 0 ? `Hoy ${who} debía pagarte ${formatCOP(rest)}.`
          : `${who} debía pagarte ${formatCOP(rest)} en ${days} día${plural}.`;
      }
      return { type: 'debt', tone: 'amber', message };
    }

    // 2) Presupuesto del mes excedido (solo aviso).
    if (Object.keys(budgets).length) {
      const mStart = startOfMonth(now);
      const mEnd = endOfMonth(now);
      const spentByCat: Record<string, number> = {};
      for (const tx of transactions) {
        if (tx.type === 'expense' && isReportableFinancialTransaction(tx) && tx.date >= mStart && tx.date <= mEnd) {
          spentByCat[tx.category] = (spentByCat[tx.category] || 0) + toMoney(tx.amount);
        }
      }
      const over = Object.entries(budgets)
        .map(([cat, limit]) => ({ cat, limit, spent: spentByCat[cat] || 0 }))
        .filter((x) => x.spent > x.limit)
        .sort((a, b) => (b.spent - b.limit) - (a.spent - a.limit));
      if (over.length) {
        const o = over[0];
        return { type: 'budget', tone: 'red', message: `Te pasaste del presupuesto de ${o.cat}: llevas ${formatCOP(o.spent)} de ${formatCOP(o.limit)} este mes. Es solo un aviso 🙂` };
      }
    }

    // 3) Muchos gastos de gustos en la semana.
    const cutoff = subDays(startOfDay(now), 6);
    const week = transactions.filter((tx) => isReportableFinancialTransaction(tx) && tx.type === 'expense' && tx.date >= cutoff);
    const disc = week.filter((tx) => DISCRETIONARY.has(tx.category));
    if (disc.length >= 2) {
      const discSum = disc.reduce((s, tx) => s + toMoney(tx.amount), 0);
      const weekSum = week.reduce((s, tx) => s + toMoney(tx.amount), 0);
      const share = weekSum > 0 ? discSum / weekSum : 0;
      if (disc.length >= 4 || discSum >= 150_000 || (share >= 0.5 && discSum >= 60_000)) {
        const byCat = disc.reduce((acc, tx) => { acc[tx.category] = (acc[tx.category] || 0) + toMoney(tx.amount); return acc; }, {} as Record<string, number>);
        const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]?.[0] || 'gustos';
        return { type: 'spend', tone: 'amber', message: `Oye 👋 esta semana llevas ${formatCOP(discSum)} en gustos (sobre todo ${topCat}), en ${disc.length} compras. ¿Lo revisamos para no salirnos del presupuesto?` };
      }
    }
    return null;
  }, [transactions, debts, budgets]);

  const visible = nudge && !dismissed.has(nudge.type);
  if (loading || !visible || location.pathname === '/chat') return null;

  const close = () => {
    const next = new Set(dismissed);
    next.add(nudge.type);
    setDismissed(next);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify({ day: todayKey(), types: [...next] })); } catch { /* ignora */ }
  };

  const border = nudge.tone === 'red' ? 'border-red-400/40' : 'border-amber-400/30';
  const iconColor = nudge.tone === 'red' ? 'text-red-200' : 'text-amber-200';
  const Icon = nudge.type === 'debt' ? CalendarClock : nudge.type === 'budget' ? AlertTriangle : PiggyBank;
  const chatMsg = nudge.type === 'debt' ? '¿Cómo van mis deudas?' : nudge.type === 'budget' ? '¿Cómo voy con mi presupuesto este mes?' : '¿En qué se me está yendo la plata esta semana?';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 md:inset-x-auto md:bottom-6 md:right-6 md:left-auto md:justify-end md:px-0">
      <div className={`pointer-events-auto w-full max-w-sm rounded-3xl border ${border} bg-slate-900/95 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl`}>
        <div className="flex items-start gap-3">
          <div className={`premium-icon flex h-10 w-10 shrink-0 items-center justify-center ${iconColor}`}><Icon className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-300">Tu copiloto</p>
              <button onClick={close} className="rounded-lg p-1 text-slate-500 hover:text-slate-200" title="Cerrar por hoy"><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-slate-100">{nudge.message}</p>
            <div className="mt-3 flex items-center gap-2">
              <button onClick={() => { close(); navigate(nudge.type === 'debt' ? '/debts' : '/chat'); }} className="premium-button inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-black">
                <Sparkles className="h-3.5 w-3.5" />{nudge.type === 'debt' ? 'Ver deudas' : 'Revisar con el copiloto'}
              </button>
              <button onClick={close} className="soft-button rounded-2xl px-3 py-2 text-xs font-black">Entendido</button>
            </div>
            {nudge.type !== 'debt' && <p className="mt-2 text-[10px] text-slate-500">Tip: pregúntale al copiloto "{chatMsg}"</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
