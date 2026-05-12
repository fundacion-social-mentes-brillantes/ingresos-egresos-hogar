import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, CheckCircle2, HandCoins, Loader2, Plus, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getAccounts } from '../lib/firestore';
import { createDebtWithMoneyMovement, registerDebtPaymentWithMoneyMovement } from '../lib/debtMoney';
import { useDebts } from '../hooks/useDebts';
import type { Account, Debt, DebtDirection } from '../types';
import { formatCOP } from '../types';
import { EmptyState } from '../components/visual/EmptyState';
import { parseCurrencyInput, toMoney } from '../lib/accounting';

const emptyForm = {
  direction: 'receivable' as DebtDirection,
  personName: '',
  amountOriginal: '',
  description: '',
  notes: '',
  dueDate: '',
};

function parseDateInput(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00-05:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function remaining(debt: Debt): number {
  return Math.max(0, toMoney(debt.amountOriginal) - toMoney(debt.amountPaid));
}

function directionText(direction: DebtDirection) {
  return direction === 'receivable'
    ? { tab: 'Me deben', account: 'Cuenta de donde sale la plata', help: 'Si prestas plata, se descuenta de esta cuenta y queda como cuenta por cobrar, no como gasto normal.', payAccount: 'Cuenta donde entra el abono' }
    : { tab: 'Yo debo', account: 'Cuenta donde entra la plata', help: 'Si pides prestado, se suma a esta cuenta y queda como cuenta por pagar, no como ingreso normal.', payAccount: 'Cuenta de donde sale el pago' };
}

function statusLabel(debt: Debt): string {
  if (debt.status === 'paid') return 'Pagada';
  if (debt.amountPaid > 0) return 'Parcial';
  return 'Pendiente';
}

export function DebtsPage() {
  const { user } = useAuth();
  const { debts, loading, summary } = useDebts();
  const [form, setForm] = useState(emptyForm);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [createAccountId, setCreateAccountId] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState<Record<string, string>>({});
  const [paymentAmount, setPaymentAmount] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'open' | 'all' | 'receivable' | 'payable'>('open');
  const [saving, setSaving] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = async () => {
    if (!user) return;
    const items = await getAccounts(user.uid);
    setAccounts(items.filter((account) => account.active !== false));
  };

  useEffect(() => {
    loadAccounts().catch((err) => console.warn('No pude cargar cuentas para deudas', err));
  }, [user?.uid]);

  const filteredDebts = useMemo(() => debts.filter((debt) => {
    if (filter === 'open') return debt.status !== 'paid' && !debt.isReversed;
    if (filter === 'receivable') return debt.direction === 'receivable';
    if (filter === 'payable') return debt.direction === 'payable';
    return true;
  }), [debts, filter]);

  const selectedCreateAccount = accounts.find((account) => account.id === createAccountId);
  const copy = directionText(form.direction);

  const handleCreate = async () => {
    if (!user) return;
    setError(null);
    let amountOriginal = 0;
    try {
      amountOriginal = parseCurrencyInput(form.amountOriginal);
    } catch (err: any) {
      return setError(err?.message || 'Escribe un valor válido.');
    }
    if (!form.personName.trim()) return setError('Escribe quién debe o a quién le debes.');
    if (!selectedCreateAccount) return setError(copy.account + '.');

    setSaving(true);
    try {
      await createDebtWithMoneyMovement(user.uid, {
        direction: form.direction,
        personName: form.personName.trim(),
        amountOriginal,
        amountPaid: 0,
        currency: 'COP',
        description: form.description.trim() || (form.direction === 'receivable' ? 'Plata prestada' : 'Deuda por pagar'),
        notes: form.notes.trim() || null,
        dueDate: parseDateInput(form.dueDate),
        status: 'open',
        source: 'manual',
        confidence: 1,
      }, selectedCreateAccount);
      setForm(emptyForm);
      setCreateAccountId('');
      await loadAccounts();
    } catch (err: any) {
      setError(err?.message || 'No pude guardar la deuda.');
    } finally {
      setSaving(false);
    }
  };

  const handlePayment = async (debt: Debt, amountOverride?: number) => {
    if (!user) return;
    const account = accounts.find((item) => item.id === paymentAccountId[debt.id]);
    let amount = amountOverride ?? 0;
    try {
      if (amountOverride === undefined) amount = parseCurrencyInput(paymentAmount[debt.id] || '');
    } catch (err: any) {
      return setError(err?.message || 'Escribe cuánto abonaron o cuánto pagaste.');
    }
    if (!account) return setError(directionText(debt.direction).payAccount + '.');
    if (!amount || amount <= 0) return setError('Escribe cuánto abonaron o cuánto pagaste.');

    setPayingId(debt.id);
    setError(null);
    try {
      await registerDebtPaymentWithMoneyMovement(user.uid, debt.id, amount, account);
      setPaymentAmount((prev) => ({ ...prev, [debt.id]: '' }));
      await loadAccounts();
    } catch (err: any) {
      setError(err?.message || 'No pude registrar el abono.');
    } finally {
      setPayingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-10">
      <section className="lux-hero relative p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="lux-kicker">Control de obligaciones protegido</p>
            <h1 className="lux-heading mt-2 text-3xl sm:text-4xl">Deudas y plata prestada</h1>
            <p className="lux-subtle mt-2 max-w-2xl text-sm">Cada deuda mueve una cuenta real. El borrado destructivo fue deshabilitado para conservar trazabilidad.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[520px]">
            <Metric title="Te deben" value={summary.receivable} tone="green" />
            <Metric title="Tú debes" value={summary.payable} tone="red" />
            <Metric title="Balance neto" value={summary.net} tone="blue" />
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[390px_1fr]">
        <section className="lux-card p-5">
          <div className="mb-4 flex items-center gap-2"><div className="premium-icon h-10 w-10 text-blue-200"><Plus className="h-5 w-5" /></div><div><h2 className="font-black text-slate-100">Añadir deuda</h2><p className="text-xs text-slate-500">Registro protegido con movimiento de cuenta</p></div></div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-700/40 bg-slate-900/50 p-1">
              {(['receivable', 'payable'] as DebtDirection[]).map((direction) => <button key={direction} onClick={() => { setForm((prev) => ({ ...prev, direction })); setCreateAccountId(''); }} className={`rounded-xl px-3 py-2 text-sm font-black transition ${form.direction === direction ? (direction === 'receivable' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300') : 'text-slate-500 hover:text-slate-300'}`}>{directionText(direction).tab}</button>)}
            </div>
            <input className="lux-input w-full rounded-2xl px-4 py-3 text-sm outline-none" placeholder="Persona o entidad" value={form.personName} onChange={(event) => setForm((prev) => ({ ...prev, personName: event.target.value }))} />
            <input className="lux-input w-full rounded-2xl px-4 py-3 text-sm outline-none" placeholder="Valor total, ej: 599.000" type="text" value={form.amountOriginal} onChange={(event) => setForm((prev) => ({ ...prev, amountOriginal: event.target.value }))} />
            <select className="lux-input w-full rounded-2xl px-4 py-3 text-sm outline-none" value={createAccountId} onChange={(event) => setCreateAccountId(event.target.value)}>
              <option value="">{copy.account}</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} - {formatCOP(account.currentBalance)}</option>)}
            </select>
            <p className="text-xs leading-relaxed text-slate-500">{copy.help}</p>
            <input className="lux-input w-full rounded-2xl px-4 py-3 text-sm outline-none" placeholder="Descripción" value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
            <input className="lux-input w-full rounded-2xl px-4 py-3 text-sm outline-none" placeholder="Fecha prometida de pago" type="date" value={form.dueDate} onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))} />
            <textarea className="lux-input min-h-24 w-full resize-none rounded-2xl px-4 py-3 text-sm outline-none" placeholder="Notas opcionales" value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
            {error && <div className="flex gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
            <button onClick={handleCreate} disabled={saving} className="premium-button flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black transition disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Guardar y mover cuenta</button>
          </div>
        </section>

        <section className="lux-card p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-black text-slate-100">Listado</h2><p className="text-xs text-slate-500">{summary.openCount} pendientes abiertas o parciales</p></div><div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">{(['open', 'all', 'receivable', 'payable'] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-2xl px-4 py-2 text-xs font-black transition ${filter === item ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'soft-button'}`}>{item === 'open' ? 'Pendientes' : item === 'all' ? 'Todas' : item === 'receivable' ? 'Me deben' : 'Yo debo'}</button>)}</div></div>
          {loading ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-blue-400" /></div> : filteredDebts.length === 0 ? <EmptyState asset="debts" title="No hay deudas en esta vista" description="Puedes crearlas manualmente o desde el chat indicando valor y cuenta." /> : <div className="grid gap-3">{filteredDebts.map((debt) => {
            const rest = remaining(debt);
            const progress = debt.amountOriginal > 0 ? Math.min(100, (debt.amountPaid / debt.amountOriginal) * 100) : 0;
            const debtCopy = directionText(debt.direction);
            return <article key={debt.id} className="rounded-3xl border border-slate-700/50 bg-slate-900/40 p-4 shadow-lg shadow-black/10">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-black ${debt.direction === 'receivable' ? 'border-green-400/25 bg-green-400/10 text-green-300' : 'border-red-400/25 bg-red-400/10 text-red-300'}`}>{debt.direction === 'receivable' ? 'Te deben' : 'Tú debes'}</span><span className="rounded-full border border-blue-400/25 bg-blue-400/10 px-3 py-1 text-xs font-black text-blue-300">{statusLabel(debt)}</span><span className="inline-flex items-center gap-1 rounded-full border border-slate-600/30 bg-slate-800/50 px-3 py-1 text-xs font-black text-slate-300"><ShieldCheck className="h-3 w-3" />Sin borrado</span></div><h3 className="mt-3 truncate text-xl font-black text-slate-100">{debt.personName}</h3><p className="text-sm text-slate-400">{debt.description}</p>{(debt as any).linkedAccountName && <p className="mt-2 text-xs font-bold text-slate-500">Cuenta inicial: {(debt as any).linkedAccountName}</p>}{debt.dueDate && <p className="mt-3 flex items-center gap-2 text-xs font-bold text-amber-300"><CalendarClock className="h-4 w-4" />Fecha pactada: {debt.dueDate.toLocaleDateString('es-CO')}</p>}</div><div className="min-w-[190px] text-left lg:text-right"><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Saldo pendiente</p><p className={`mt-1 text-3xl font-black ${debt.direction === 'receivable' ? 'text-green-300' : 'text-red-300'}`}>{formatCOP(rest)}</p><p className="mt-1 text-xs text-slate-500">Total: {formatCOP(debt.amountOriginal)} · Abonado: {formatCOP(debt.amountPaid)}</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800/70"><div className="h-full rounded-full bg-gradient-to-r from-blue-400 to-green-300" style={{ width: `${progress}%` }} /></div></div></div>
              {debt.status !== 'paid' && <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]"><select className="lux-input min-w-0 rounded-2xl px-4 py-2.5 text-sm outline-none" value={paymentAccountId[debt.id] || ''} onChange={(event) => setPaymentAccountId((prev) => ({ ...prev, [debt.id]: event.target.value }))}><option value="">{debtCopy.payAccount}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} - {formatCOP(account.currentBalance)}</option>)}</select><input className="lux-input min-w-0 rounded-2xl px-4 py-2.5 text-sm outline-none" placeholder="Abono o pago" type="text" value={paymentAmount[debt.id] || ''} onChange={(event) => setPaymentAmount((prev) => ({ ...prev, [debt.id]: event.target.value }))} /><button onClick={() => handlePayment(debt)} disabled={payingId === debt.id} className="premium-button inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-black transition disabled:opacity-50">{payingId === debt.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}Abonar</button><button onClick={() => handlePayment(debt, rest)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-green-400/25 bg-green-500/15 px-4 py-2.5 text-sm font-black text-green-200 transition hover:bg-green-500/20"><CheckCircle2 className="h-4 w-4" />Pagada</button></div>}
            </article>;
          })}</div>}
        </section>
      </div>
    </div>
  );
}

function Metric({ title, value, tone }: { title: string; value: number; tone: 'green' | 'red' | 'blue' }) {
  const color = tone === 'green' ? 'border-green-500/20 bg-green-500/10 text-green-300' : tone === 'red' ? 'border-red-500/20 bg-red-500/10 text-red-300' : 'border-blue-500/20 bg-blue-500/10 text-blue-300';
  return <div className={`rounded-3xl border p-4 ${color}`}><p className="text-xs font-black uppercase tracking-[0.16em]">{title}</p><p className="mt-1 text-xl font-black text-slate-100">{formatCOP(value)}</p></div>;
}

export default DebtsPage;
