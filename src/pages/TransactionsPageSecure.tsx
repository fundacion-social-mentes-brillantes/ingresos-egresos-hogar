import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { endOfMonth, endOfYear, startOfMonth, startOfYear } from 'date-fns';
import { CalendarRange, Download, LayoutGrid, Loader2, Pencil, Plus, Search, ShieldCheck, Table, Trash2, Wallet } from 'lucide-react';
import { exportTransactionsTable } from '../lib/reporting';
import { useAuth } from '../contexts/AuthContext';
import { useTransactions } from '../hooks/useTransactions';
import { deleteTransaction, getAllTransactions } from '../lib/firestore';
import { transferBetweenAccountsSafe } from '../lib/transferOperations';
import { adjustAccountToRealBalance, correctAccountingTransaction, createAccountingTransaction, genericReversalBlockReason, reverseTransfer } from '../lib/accountingOperations';
import { inferMovementKind, isProtectedTransaction, isReportableFinancialTransaction, parseCurrencyInput, toMoney } from '../lib/accounting';
import { asDate, formDateTimeFromDate, nowTimeStr, todayStr } from '../lib/dateForm';
import { CATEGORIES, formatCOP } from '../types';
import type { Account, Transaction, TransactionType } from '../types';

type FormState = { type: TransactionType; amount: string; category: string; accountId: string; description: string; date: string; time: string };

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Para movimientos NUEVOS solo ofrecemos Efectivo y Banco (peticion de uso real).
// Las cuentas viejas (Nequi, Daviplata, "Aki plata", etc.) se conservan en el
// historial pero ya no aparecen para registrar cosas nuevas.
const norm = (s: string) => s.trim().toLowerCase();
const isCashName = (a: Account) => a.type === 'cash' || norm(a.name) === 'efectivo';
const isBankName = (a: Account) => a.type === 'bank' || norm(a.name) === 'banco';

function pickFormAccounts(active: Account[]): Account[] {
  const byName = active.filter((a) => norm(a.name) === 'efectivo' || norm(a.name) === 'banco');
  if (byName.length) return byName;
  const byType = active.filter((a) => a.type === 'cash' || a.type === 'bank');
  return byType.length ? byType : active;
}

function defaultAccountId(list: Account[]): string {
  const banco = list.find((a) => isBankName(a));
  return (banco || list[0])?.id || '';
}

const blank = (accounts: Account[]): FormState => ({ type: 'expense', amount: '', category: 'Otros', accountId: defaultAccountId(accounts), description: '', date: todayStr(), time: nowTimeStr() });
const isTransfer = (tx: Transaction | null) => Boolean(tx?.transferId) || (tx ? inferMovementKind(tx).startsWith('transfer') : false);

function formFromTx(tx: Transaction, accounts: Account[]): FormState {
  // Conservamos la fecha/hora original del movimiento. Antes se reseteaba a hoy,
  // de modo que corregir un gasto de un mes pasado lo movia al mes actual y
  // distorsionaba los reportes mensuales (lo sacaba de su mes real).
  const { date, time } = formDateTimeFromDate(tx.date);
  return { type: tx.type, amount: String(tx.amount), category: tx.category || (tx.type === 'income' ? 'Ingreso' : 'Otros'), accountId: tx.accountId || accounts[0]?.id || '', description: tx.description || '', date, time };
}

function label(tx: Transaction) {
  const kind = inferMovementKind(tx);
  if (kind === 'transfer_in') return 'Transferencia entrada';
  if (kind === 'transfer_out') return 'Transferencia salida';
  if (kind === 'loan_given') return 'Prestamo otorgado';
  if (kind === 'loan_received') return 'Prestamo recibido';
  if (kind === 'loan_payment_received') return 'Abono recibido';
  if (kind === 'debt_payment_made') return 'Pago de deuda';
  if (kind === 'reconciliation_adjustment') return 'Ajuste';
  if (kind === 'historical_non_reportable') return 'Historico';
  return tx.type === 'income' ? 'Ingreso' : 'Gasto';
}

function protectedMessage(tx: Transaction): string | null {
  if (isTransfer(tx)) return tx.transferId ? null : 'Movimiento de transferencia protegido: no tiene transferId, asi que no puedo tocar una sola pata.';
  return genericReversalBlockReason(tx);
}

// Suma ingresos/gastos reportables y cuenta los movimientos reales (no reversados)
// de un conjunto ya filtrado por periodo.
function aggregate(txs: Transaction[]) {
  let income = 0, expense = 0, count = 0;
  for (const tx of txs) {
    if (tx.isReversed || tx.reversalOf) continue;
    count += 1;
    if (isReportableFinancialTransaction(tx)) {
      if (tx.type === 'income') income += toMoney(tx.amount);
      else expense += toMoney(tx.amount);
    }
  }
  return { income, expense, balance: income - expense, count };
}

export function TransactionsPage() {
  const { user } = useAuth();
  const { accounts } = useTransactions();
  const [allTx, setAllTx] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'income' | 'expense'>('all');
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [form, setForm] = useState<FormState>(() => blank([]));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<'cards' | 'table'>(() => {
    if (typeof window === 'undefined') return 'cards';
    return localStorage.getItem('movimientos_view') === 'table' ? 'table' : 'cards';
  });
  const setViewPersist = (next: 'cards' | 'table') => {
    setView(next);
    try { localStorage.setItem('movimientos_view', next); } catch { /* ignorar */ }
  };

  const now = useMemo(() => new Date(), []);
  const year = now.getFullYear();
  const currentMonth = now.getMonth();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  const loadAllTx = useCallback(async () => {
    if (!user) return;
    setTxLoading(true);
    try { setAllTx(await getAllTransactions(user.uid)); }
    catch { /* conservamos lo que ya haya */ }
    finally { setTxLoading(false); }
  }, [user]);

  useEffect(() => { loadAllTx().catch(() => setTxLoading(false)); }, [loadAllTx]);

  const activeAccounts = useMemo(() => accounts.filter((a) => a.active !== false), [accounts]);
  const formAccounts = useMemo(() => pickFormAccounts(activeAccounts), [activeAccounts]);

  // Al editar dejamos elegir cualquier cuenta e incluimos la cuenta original del
  // movimiento aunque este inactiva, para no cambiarla sin querer al guardar.
  const accountOptions = useMemo(() => {
    const base = editing ? activeAccounts.slice() : formAccounts.slice();
    if (form.accountId && !base.some((a) => a.id === form.accountId)) {
      const cur = accounts.find((a) => a.id === form.accountId);
      if (cur) base.unshift(cur);
    }
    return base;
  }, [editing, activeAccounts, formAccounts, accounts, form.accountId]);

  // Si abren "Manual" antes de que carguen las cuentas (listener en tiempo real),
  // en cuanto lleguen fijamos Banco por defecto para que no quede sin cuenta.
  useEffect(() => {
    if (open && !editing && !form.accountId && formAccounts.length) {
      setForm((f) => ({ ...f, accountId: defaultAccountId(formAccounts) }));
    }
  }, [open, editing, form.accountId, formAccounts]);

  // Saldo actual (dinero de verdad hoy): saldos mantenidos por el motor contable.
  // Banco y Efectivo se muestran por su cuenta real (para poder corregirlas una a
  // una); si otras cuentas viejas aun guardan plata, se muestra "Otras cuentas"
  // para que el total siempre cuadre a la vista.
  // Exclusion mutua garantizada: una misma cuenta (p. ej. "Banco" creada con
  // tipo efectivo) jamas puede quedar como Banco Y Efectivo a la vez, porque
  // duplicaria su saldo en pantalla y volveria negativo el resto de "Otras".
  const { efectivoAcc, bancoAcc } = useMemo(() => {
    const bancoByName = activeAccounts.find((a) => norm(a.name) === 'banco') || null;
    const efectivoByName = activeAccounts.find((a) => norm(a.name) === 'efectivo') || null;
    const efectivo = efectivoByName || activeAccounts.find((a) => isCashName(a) && a.id !== bancoByName?.id) || null;
    const banco = (bancoByName && bancoByName.id !== efectivo?.id ? bancoByName : null)
      || activeAccounts.find((a) => isBankName(a) && a.id !== efectivo?.id) || null;
    return { efectivoAcc: efectivo, bancoAcc: banco };
  }, [activeAccounts]);
  const saldo = useMemo(() => {
    const total = activeAccounts.reduce((s, a) => s + toMoney(a.currentBalance), 0);
    const efectivo = efectivoAcc ? toMoney(efectivoAcc.currentBalance) : 0;
    const banco = bancoAcc ? toMoney(bancoAcc.currentBalance) : 0;
    return { total, efectivo, banco, otras: total - efectivo - banco };
  }, [activeAccounts, efectivoAcc, bancoAcc]);

  // Modal "Corregir saldo": la persona escribe cuanto tiene DE VERDAD y la app
  // crea un ajuste contable atomico para quedar igual a la vida real.
  const [adjusting, setAdjusting] = useState<Account | null>(null);
  const [realInput, setRealInput] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState('');
  // parseError se muestra DENTRO del modal: antes se tragaba la excepcion y el
  // boton solo quedaba gris sin explicar que formato acepta (ej: "300.00").
  const adjustParsed = useMemo(() => {
    if (!adjusting || !realInput.trim()) return { real: null as number | null, delta: 0, parseError: '' };
    try {
      const real = parseCurrencyInput(realInput);
      return { real, delta: real - toMoney(adjusting.currentBalance), parseError: '' };
    } catch (err: any) { return { real: null, delta: 0, parseError: err?.message || 'Valor invalido' }; }
  }, [adjusting, realInput]);

  function openAdjust(acc: Account) { setAdjusting(acc); setRealInput(''); setAdjustError(''); setError(''); }

  async function confirmAdjust(e: FormEvent) {
    e.preventDefault();
    if (!user || !adjusting || adjustBusy || adjustParsed.real === null) return;
    setAdjustBusy(true);
    setAdjustError('');
    try {
      await adjustAccountToRealBalance(user.uid, adjusting.id, adjustParsed.real);
      setAdjusting(null);
      await loadAllTx(); // el saldo de cuentas se refresca solo (listener en tiempo real)
    } catch (err: any) {
      // El modal se queda ABIERTO con el error visible: si se cerrara, un fallo
      // (sin internet, regla rechazada) seria indistinguible de un exito.
      setAdjustError(err?.message || 'No pude ajustar el saldo. Revisa tu conexion e intenta de nuevo.');
    }
    finally { setAdjustBusy(false); }
  }

  const monthRange = useMemo(() => ({ start: startOfMonth(new Date(year, selectedMonth, 1)), end: endOfMonth(new Date(year, selectedMonth, 1)) }), [year, selectedMonth]);
  const yearRange = useMemo(() => ({ start: startOfYear(now), end: endOfYear(now) }), [now]);

  const monthTx = useMemo(() => allTx.filter((tx) => tx.date >= monthRange.start && tx.date <= monthRange.end), [allTx, monthRange]);
  const yearTx = useMemo(() => allTx.filter((tx) => tx.date >= yearRange.start && tx.date <= yearRange.end), [allTx, yearRange]);
  const monthAgg = useMemo(() => aggregate(monthTx), [monthTx]);
  const yearAgg = useMemo(() => aggregate(yearTx), [yearTx]);

  const filtered = useMemo(() => monthTx.filter((tx) => {
    const text = `${tx.description} ${tx.category} ${tx.accountName}`.toLowerCase();
    return (kind === 'all' || tx.type === kind) && text.includes(query.toLowerCase());
  }), [monthTx, kind, query]);

  function openCreate() { setEditing(null); setForm(blank(formAccounts)); setError(''); setOpen(true); }
  function openEdit(tx: Transaction) {
    if (tx.isReversed || tx.reversalOf) return setError('Ese movimiento ya esta reversado.');
    const reason = protectedMessage(tx);
    if (reason) return setError(`${reason} Para deudas usa la pantalla Deudas; para historicos/importados mantenlos como historicos.`);
    setEditing(tx); setForm(formFromTx(tx, accounts)); setError(''); setOpen(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    try {
      const amount = parseCurrencyInput(form.amount);
      const date = asDate(form.date, form.time);
      const description = form.description.trim() || (isTransfer(editing) ? 'Transferencia entre cuentas' : form.type === 'income' ? 'Ingreso manual' : 'Gasto manual');
      if (editing && isTransfer(editing) && editing.transferId) {
        const from = editing.transferDirection === 'in' ? editing.transferAccountId : editing.accountId;
        const to = editing.transferDirection === 'in' ? editing.accountId : editing.transferAccountId;
        if (!from || !to || from === to) throw new Error('No pude identificar las dos cuentas de la transferencia.');
        await reverseTransfer(user.uid, editing.transferId, 'Correccion desde Movimientos');
        await transferBetweenAccountsSafe(user.uid, { fromAccountId: from, toAccountId: to, amount, description, date, allowNegativeBalance: true });
      } else {
        if (editing) {
          const reason = protectedMessage(editing);
          if (reason) throw new Error(reason);
        }
        const account = accounts.find((a) => a.id === form.accountId);
        if (!account) throw new Error('Selecciona una cuenta.');
        if (editing) {
          // Correccion atomica: reverso + corregido + saldos en una sola transaccion.
          await correctAccountingTransaction(user.uid, editing.id, { type: form.type, amount, accountId: account.id, category: form.category, description, date, source: 'manual', rawText: description }, 'Correccion desde Movimientos');
        } else {
          await createAccountingTransaction(user.uid, { type: form.type, amount, accountId: account.id, category: form.category, description, date, source: 'manual', rawText: description, movementKind: form.type === 'income' ? 'income' : 'expense' });
        }
      }
      setOpen(false); setEditing(null); await loadAllTx();
    } catch (err: any) { setError(err?.message || 'No pude guardar.'); }
  }

  async function removeTx(tx: Transaction) {
    if (!user) return;
    if (tx.isReversed || tx.reversalOf) return setError('Ese movimiento ya esta reversado.');
    const reason = protectedMessage(tx);
    if (reason) return setError(`${reason} No lo quite como una sola linea para no descuadrar. Usa el flujo especifico.`);
    const ok = window.confirm(isTransfer(tx) ? 'Esto quitara la transferencia completa. Continuar?' : 'Esto quitara el efecto del movimiento. Continuar?');
    if (!ok) return;
    setBusy(tx.id);
    try {
      if (isTransfer(tx) && tx.transferId) await reverseTransfer(user.uid, tx.transferId, 'Quitar desde Movimientos');
      else await deleteTransaction(user.uid, tx.id); // archiva en papelera (recuperable) y luego reversa
      await loadAllTx();
    } catch (err: any) { setError(err?.message || 'No pude quitar el movimiento.'); }
    finally { setBusy(null); }
  }

  const monthName = MONTHS[selectedMonth];
  const isCurrentMonth = selectedMonth === currentMonth;

  return <div className="space-y-6 pb-10">
    <section className="lux-hero p-5 sm:p-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="lux-kicker">Libro personal</p>
          <h1 className="lux-heading mt-2 text-3xl sm:text-4xl">Movimientos</h1>
          <p className="lux-subtle mt-2 text-sm">Por defecto ves el mes actual. Cambia de mes con el selector, revisa el histórico del año y tu saldo actual sin salir de aquí.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 rounded-2xl border border-slate-700/40 bg-slate-900/50 px-3 py-2">
            <CalendarRange className="h-4 w-4 text-blue-300" />
            <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Mes</span>
            <select className="bg-transparent text-sm font-black text-slate-100 outline-none" value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}>
              {MONTHS.slice(0, currentMonth + 1).map((m, i) => <option key={i} value={i} className="bg-slate-900">{m} {year}</option>)}
            </select>
          </label>
          <button className="premium-button rounded-3xl px-5 py-3 font-black" onClick={openCreate}><Plus className="mr-2 inline h-4 w-4" />Manual</button>
        </div>
      </div>
      <div className="mt-6">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Resumen de {monthName}{isCurrentMonth ? ' (mes actual)' : ''}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Ingresos del mes" value={formatCOP(monthAgg.income)} tone="green" />
          <Stat label="Gastos del mes" value={formatCOP(monthAgg.expense)} tone="red" />
          <Stat label="Movimientos del mes" value={String(monthAgg.count)} tone="blue" />
          <Stat label="Balance del mes" value={formatCOP(monthAgg.balance)} tone={monthAgg.balance >= 0 ? 'green' : 'red'} />
        </div>
      </div>
    </section>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="lux-card p-5">
        <div className="flex items-center gap-2"><Wallet className="h-4 w-4 text-pink-400" /><h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-300">Saldo actual</h2></div>
        <p className="saldo-glow mt-3 text-3xl font-black">{formatCOP(saldo.total)}</p>
        <p className="text-xs text-slate-500">Dinero disponible en total ahora mismo</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Banco</p>
            <p className="mt-1 text-lg font-black text-slate-100">{formatCOP(saldo.banco)}</p>
            {bancoAcc && <button type="button" onClick={() => openAdjust(bancoAcc)} className="mt-2 inline-flex items-center gap-1 rounded-xl border border-pink-400/30 bg-pink-500/10 px-2.5 py-1 text-[10px] font-black text-pink-300 hover:bg-pink-500/20"><Pencil className="h-3 w-3" />Corregir</button>}
          </div>
          <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Efectivo</p>
            <p className="mt-1 text-lg font-black text-slate-100">{formatCOP(saldo.efectivo)}</p>
            {efectivoAcc && <button type="button" onClick={() => openAdjust(efectivoAcc)} className="mt-2 inline-flex items-center gap-1 rounded-xl border border-pink-400/30 bg-pink-500/10 px-2.5 py-1 text-[10px] font-black text-pink-300 hover:bg-pink-500/20"><Pencil className="h-3 w-3" />Corregir</button>}
          </div>
        </div>
        {saldo.otras !== 0 && <p className="mt-3 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3 text-xs font-bold text-slate-400">Otras cuentas guardan {formatCOP(saldo.otras)} (cuentas antiguas del historial).</p>}
        <p className="mt-3 text-[10px] text-slate-500">¿No cuadra con lo que tienes en la mano? Toca "Corregir", escribe cuánto tienes de verdad y la app crea un ajuste para quedar igual a la vida real.</p>
      </section>
      <section className="lux-card p-5">
        <div className="flex items-center gap-2"><CalendarRange className="h-4 w-4 text-blue-300" /><h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-300">Histórico del año {year}</h2></div>
        <p className="mt-1 text-xs text-slate-500">Acumulado de enero a hoy</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-green-400/20 bg-green-400/10 p-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-green-300">Ingresos</p><p className="mt-1 text-lg font-black text-slate-100">{formatCOP(yearAgg.income)}</p></div>
          <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-red-300">Gastos</p><p className="mt-1 text-lg font-black text-slate-100">{formatCOP(yearAgg.expense)}</p></div>
          <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Balance</p><p className={`mt-1 text-lg font-black ${yearAgg.balance >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{formatCOP(yearAgg.balance)}</p></div>
          <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Movimientos</p><p className="mt-1 text-lg font-black text-slate-100">{yearAgg.count}</p></div>
        </div>
      </section>
    </div>

    {error && <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm font-bold text-amber-100">{error}</div>}
    <section className="lux-card p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="relative w-full lg:w-96"><Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-500" /><input className="lux-input w-full rounded-2xl py-3 pl-11 pr-4 text-sm outline-none" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en este mes..." /></div><div className="flex flex-wrap items-center gap-2"><button className={`soft-button rounded-2xl px-4 py-2 font-black ${kind === 'all' ? 'text-blue-200' : ''}`} onClick={() => setKind('all')}>Todos</button><button className={`soft-button rounded-2xl px-4 py-2 font-black ${kind === 'income' ? 'text-green-200' : ''}`} onClick={() => setKind('income')}>Ingresos</button><button className={`soft-button rounded-2xl px-4 py-2 font-black ${kind === 'expense' ? 'text-red-200' : ''}`} onClick={() => setKind('expense')}>Salidas</button><div className="ml-auto flex items-center gap-1 rounded-2xl border border-slate-700/40 bg-slate-900/50 p-1 lg:ml-1"><button type="button" title="Vista tarjetas" onClick={() => setViewPersist('cards')} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black transition ${view === 'cards' ? 'bg-blue-500/20 text-blue-100' : 'text-slate-400 hover:text-slate-200'}`}><LayoutGrid className="h-4 w-4" />Tarjetas</button><button type="button" title="Vista tabla tipo Excel" onClick={() => setViewPersist('table')} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black transition ${view === 'table' ? 'bg-blue-500/20 text-blue-100' : 'text-slate-400 hover:text-slate-200'}`}><Table className="h-4 w-4" />Tabla</button></div><button type="button" title="Descargar a Excel lo que se ve ahora" disabled={filtered.length === 0} onClick={() => { exportTransactionsTable(filtered, `movimientos-${monthName.toLowerCase()}-${year}.xlsx`).catch((err) => setError(err?.message || 'No pude exportar.')); }} className="soft-button inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-black disabled:opacity-40"><Download className="h-4 w-4" />Excel</button></div></div></section>
    <section className="premium-panel rounded-[1.6rem] border border-slate-700/40 p-3">
      {txLoading ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex h-48 items-center justify-center px-4 text-center text-sm text-slate-500">No hay movimientos en {monthName} de {year}{query || kind !== 'all' ? ' para este filtro' : ''}.</div>
      ) : view === 'table' ? (
        <div className="custom-scrollbar overflow-x-auto rounded-2xl border border-slate-800/60">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-700/60 bg-slate-900/60 text-left text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">
                <th className="px-3 py-3">Fecha</th>
                <th className="px-3 py-3">Tipo</th>
                <th className="px-3 py-3">Descripcion</th>
                <th className="px-3 py-3">Categoria</th>
                <th className="px-3 py-3">Cuenta</th>
                <th className="px-3 py-3 text-right">Valor</th>
                <th className="px-3 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx, i) => {
                const reversed = Boolean(tx.isReversed || tx.reversalOf);
                return (
                  <tr key={tx.id} className={`border-b border-slate-800/60 ${i % 2 === 1 ? 'bg-slate-900/30' : ''} ${reversed ? 'opacity-50' : 'hover:bg-slate-800/40'}`}>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-400">{tx.date.toLocaleDateString('es-CO')}</td>
                    <td className="px-3 py-2.5"><span className={`inline-flex rounded-lg px-2 py-0.5 text-[10px] font-black ${tx.type === 'income' ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>{label(tx)}</span></td>
                    <td className="px-3 py-2.5 font-bold text-slate-100">{tx.description}{isProtectedTransaction(tx) && <ShieldCheck className="ml-1.5 inline h-3 w-3 text-slate-500" />}{reversed && <span className="ml-2 text-[10px] font-bold text-slate-500">(reversado)</span>}</td>
                    <td className="px-3 py-2.5 text-slate-300">{tx.category}</td>
                    <td className="px-3 py-2.5 text-slate-300">{tx.accountName}</td>
                    <td className={`whitespace-nowrap px-3 py-2.5 text-right font-black ${tx.type === 'income' ? 'text-green-300' : 'text-red-300'}`}>{tx.type === 'income' ? '+' : '-'}{formatCOP(tx.amount)}</td>
                    <td className="px-3 py-2.5"><div className="flex items-center justify-end gap-1"><button disabled={reversed} onClick={() => openEdit(tx)} className="rounded-lg p-1.5 text-slate-400 hover:text-blue-300 disabled:opacity-30"><Pencil className="h-4 w-4" /></button><button disabled={reversed || busy === tx.id} onClick={() => removeTx(tx)} className="rounded-lg p-1.5 text-slate-400 hover:text-red-300 disabled:opacity-30">{busy === tx.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3">{filtered.map((tx) => { const reversed = Boolean(tx.isReversed || tx.reversalOf); return <article key={tx.id} className="rounded-3xl border border-slate-700/40 bg-slate-900/35 p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="font-black text-slate-100">{tx.description}</p><p className="text-xs text-slate-500">{tx.accountName} · {tx.date.toLocaleDateString('es-CO')}</p><div className="mt-2 flex gap-2"><Badge>{label(tx)}</Badge>{isProtectedTransaction(tx) && <Badge><ShieldCheck className="h-3 w-3" />Protegido</Badge>}{reversed && <Badge>Reversado</Badge>}</div></div><div className="flex items-center gap-3"><p className={tx.type === 'income' ? 'font-black text-green-300' : 'font-black text-red-300'}>{tx.type === 'income' ? '+' : '-'}{formatCOP(tx.amount)}</p><button disabled={reversed} onClick={() => openEdit(tx)} className="rounded-xl p-2 text-slate-400 hover:text-blue-300 disabled:opacity-30"><Pencil className="h-4 w-4" /></button><button disabled={reversed || busy === tx.id} onClick={() => removeTx(tx)} className="rounded-xl p-2 text-slate-400 hover:text-red-300 disabled:opacity-30">{busy === tx.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button></div></div></article>; })}</div>
      )}
    </section>
    {open && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-xl sm:items-center"><form onSubmit={save} className="premium-panel my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col rounded-[2rem] border border-slate-700/50"><h2 className="shrink-0 px-5 pt-5 text-2xl font-black text-slate-100">{editing ? 'Editar' : 'Nuevo'}</h2><div className="custom-scrollbar mt-4 grid flex-1 grid-cols-1 gap-4 overflow-y-auto px-5 sm:grid-cols-2">{!isTransfer(editing) && <><Select label="Tipo" value={form.type} onChange={(v) => setForm({ ...form, type: v as TransactionType, category: v === 'income' ? 'Ingreso' : 'Otros' })} options={[['income','Ingreso'],['expense','Gasto']]} /><Select label="Cuenta" value={form.accountId} onChange={(v) => setForm({ ...form, accountId: v })} options={accountOptions.map((a) => [a.id, a.name])} /></>}<Field label="Valor" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />{!isTransfer(editing) && <Select label="Categoria" value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={CATEGORIES.map((c) => [c, c])} />}<Field label="Descripcion" value={form.description} onChange={(v) => setForm({ ...form, description: v })} /><Field label="Fecha" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} /><Field label="Hora" type="time" value={form.time} onChange={(v) => setForm({ ...form, time: v })} /></div><div className="mt-4 flex shrink-0 justify-end gap-3 border-t border-slate-700/40 px-5 py-4"><button type="button" className="soft-button rounded-2xl px-4 py-2 font-black" onClick={() => setOpen(false)}>Cancelar</button><button type="submit" className="premium-button rounded-2xl px-4 py-2 font-black">Guardar</button></div></form></div>}
    {adjusting && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-xl sm:items-center">
      <form onSubmit={confirmAdjust} className="premium-panel my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-y-auto rounded-[2rem] border border-slate-700/50 p-5">
        <h2 className="text-xl font-black text-slate-100">Corregir saldo de {adjusting.name}</h2>
        <p className="mt-1 text-xs text-slate-500">La app tiene {formatCOP(toMoney(adjusting.currentBalance))}. Escribe cuánto tienes DE VERDAD y creamos un ajuste (no toca tus ingresos ni gastos del mes).</p>
        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-black text-slate-400">¿Cuánto tienes de verdad en {adjusting.name}?</span>
          <input autoFocus inputMode="numeric" className="lux-input w-full rounded-2xl px-4 py-3 text-sm outline-none" value={realInput} onChange={(e) => setRealInput(e.target.value)} placeholder="Ej: 300.000" />
        </label>
        {adjustParsed.parseError && <p className="mt-3 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs font-bold text-amber-200">{adjustParsed.parseError} Escribe solo el número, sin decimales. Ej: 300.000</p>}
        {adjustParsed.real !== null && <p className="mt-3 rounded-2xl border border-pink-400/25 bg-pink-500/10 p-3 text-xs font-bold text-pink-200">Quedará en {formatCOP(adjustParsed.real)} · ajuste de {adjustParsed.delta >= 0 ? '+' : '−'}{formatCOP(Math.abs(adjustParsed.delta))}{adjustParsed.delta === 0 ? ' (ya cuadra, solo se confirma)' : ''}</p>}
        {adjustError && <p className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-xs font-bold text-red-200">{adjustError}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" className="soft-button rounded-2xl px-4 py-2 font-black" onClick={() => setAdjusting(null)} disabled={adjustBusy}>Cancelar</button>
          <button type="submit" className="premium-button rounded-2xl px-4 py-2 font-black disabled:opacity-40" disabled={adjustBusy || adjustParsed.real === null}>{adjustBusy ? <Loader2 className="inline h-4 w-4 animate-spin" /> : 'Ajustar'}</button>
        </div>
      </form>
    </div>}
  </div>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'green' | 'red' | 'blue' }) {
  const tones: Record<string, string> = {
    green: 'border-green-400/20 bg-green-400/10 text-green-300',
    red: 'border-red-400/20 bg-red-400/10 text-red-300',
    blue: 'border-blue-400/20 bg-blue-400/10 text-blue-300',
  };
  return <div className={`rounded-3xl border p-4 ${tones[tone]}`}><p className="text-[10px] font-black uppercase tracking-[0.16em]">{label}</p><p className="mt-1 text-lg font-black text-slate-100">{value}</p></div>;
}
function Badge({ children }: { children: React.ReactNode }) { return <span className="inline-flex items-center gap-1 rounded-full border border-slate-600/30 bg-slate-800/50 px-3 py-1 text-[10px] font-bold text-slate-300">{children}</span>; }
function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) { return <label><span className="mb-1 block text-xs font-black text-slate-400">{label}</span><input className="lux-input w-full rounded-2xl px-4 py-3 text-sm outline-none" type={type} value={value} onChange={(e) => onChange(e.target.value)} /></label>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[][] }) { return <label><span className="mb-1 block text-xs font-black text-slate-400">{label}</span><select className="lux-input w-full rounded-2xl px-4 py-3 text-sm outline-none" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>; }

export default TransactionsPage;
