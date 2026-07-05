import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { subDays, startOfDay } from 'date-fns';
import { PiggyBank, Sparkles, X } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { isReportableFinancialTransaction, toMoney } from '../../lib/accounting';
import { formatCOP } from '../../types';

// Gastos "de gustos" (potencialmente innecesarios). Necesidades como Hogar,
// Salud, Educacion, Transporte, Alimentacion y Ahorro NO cuentan aqui.
const DISCRETIONARY = new Set(['Entretenimiento', 'Ropa', 'Tecnología', 'Tecnologia']);
const DISMISS_KEY = 'spendingNudgeDismissedDate';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Aviso proactivo y AMABLE (nunca regaña): aparece como una pantallita
// emergente cuando el copiloto detecta que la semana trae muchos gastos de
// gustos. Se calcula en el cliente (sin gastar la IA) y solo se muestra una vez
// por dia. Es "uno con la pagina": mismos datos y voz que el copiloto.
export function SpendingNudge() {
  const location = useLocation();
  const navigate = useNavigate();
  const { transactions, loading } = useTransactions();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try { return localStorage.getItem(DISMISS_KEY) === todayKey(); } catch { return false; }
  });

  const signal = useMemo(() => {
    const cutoff = subDays(startOfDay(new Date()), 6);
    const week = transactions.filter((tx) => isReportableFinancialTransaction(tx) && tx.type === 'expense' && tx.date >= cutoff);
    if (week.length === 0) return null;
    const disc = week.filter((tx) => DISCRETIONARY.has(tx.category));
    const discSum = disc.reduce((sum, tx) => sum + toMoney(tx.amount), 0);
    const weekSum = week.reduce((sum, tx) => sum + toMoney(tx.amount), 0);
    const share = weekSum > 0 ? discSum / weekSum : 0;
    // Necesita al menos 2 gastos de gustos para no disparar por una sola compra.
    if (disc.length < 2) return null;
    const strong = disc.length >= 4 || discSum >= 150_000 || (share >= 0.5 && discSum >= 60_000);
    if (!strong) return null;
    const byCat = disc.reduce((acc, tx) => { acc[tx.category] = (acc[tx.category] || 0) + toMoney(tx.amount); return acc; }, {} as Record<string, number>);
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]?.[0] || 'gustos';
    return { discSum, count: disc.length, topCat };
  }, [transactions]);

  if (loading || dismissed || !signal || location.pathname === '/chat') return null;

  const close = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, todayKey()); } catch { /* ignora */ }
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 md:inset-x-auto md:bottom-6 md:right-6 md:left-auto md:justify-end md:px-0">
      <div className="pointer-events-auto w-full max-w-sm rounded-3xl border border-amber-400/30 bg-slate-900/95 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <div className="premium-icon flex h-10 w-10 shrink-0 items-center justify-center text-amber-200"><PiggyBank className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-300">Tu copiloto</p>
              <button onClick={close} className="rounded-lg p-1 text-slate-500 hover:text-slate-200" title="Cerrar"><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-slate-100">
              Oye 👋 esta semana llevas <span className="font-black text-amber-200">{formatCOP(signal.discSum)}</span> en gustos
              {signal.topCat ? <> (sobre todo <span className="font-bold">{signal.topCat}</span>)</> : null}, en {signal.count} compras. ¿Lo revisamos juntos para no salirnos del presupuesto?
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button onClick={() => { close(); navigate('/chat'); }} className="premium-button inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-black"><Sparkles className="h-3.5 w-3.5" />Revisar con el copiloto</button>
              <button onClick={close} className="soft-button rounded-2xl px-3 py-2 text-xs font-black">Estoy bien</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
