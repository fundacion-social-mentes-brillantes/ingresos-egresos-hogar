import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { LayoutGrid, Loader2, Pencil, Plus, Search, ShieldCheck, Table, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTransactions } from '../hooks/useTransactions';
import { deleteTransaction, getAccounts } from '../lib/firestore';
import { transferBetweenAccountsSafe } from '../lib/transferOperations';
import { correctAccountingTransaction, createAccountingTransaction, genericReversalBlockReason, reverseTransfer } from '../lib/accountingOperations';
import { inferMovementKind, isProtectedTransaction, isReportableFinancialTransaction, parseCurrencyInput, toMoney } from '../lib/accounting';
import { asDate, formDateTimeFromDate, nowTimeStr, todayStr } from '../lib/dateForm';
import { CATEGORIES, formatCOP } from '../types';
import type { Account, Transaction, TransactionType } from '../types';

type FormState = { type: TransactionType; amount: string; category: string; accountId: string; description: string; date: string; time: string };

const blank = (accounts: Account[]): FormState => ({ type: 'expense', amount: '', category: 'Otros', accountId: accounts[0]?.id || '', description: '', date: todayStr(), time: nowTimeStr() });
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

export function TransactionsPage() {
  const { user } = useAuth();
  const { transactions, loading, refresh } = useTransactions();
  const [accounts, setAccounts] = useState<Account[]>([]);
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

  async function loadAccounts() {
    if (!user) return;
    setAccounts((await getAccounts(user.uid)).filter((a) => a.active !== false));
  }

  useEffect(() => { loadAccounts().catch(() => setAccounts([])); }, [user?.uid]);

  const filtered = useMemo(() => transactions.filter((tx) => {
    const text = `${tx.description} ${tx.category} ${tx.accountName}`.toLowerCase();
    return (kind === 'all' || tx.type === kind) && text.includes(query.toLowerCase());
  }), [transactions, kind, query]);

  const totals = useMemo(() => filtered.reduce((a, tx) => {
    if (tx.isReversed || tx.reversalOf) return a;
    const amount = toMoney(tx.amount);
    if (isReportableFinancialTransaction(tx)) tx.type === 'income' ? a.income += amount : a.expense += amount;
    else if (inferMovementKind(tx).startsWith('transfer')) a.transfer += amount;
    else if (inferMovementKind(tx) === 'historical_non_reportable') a.history += amount;
    return a;
  }, { income: 0, expense: 0, transfer: 0, history: 0 }), [filtered]);

  function openCreate() { setEditing(null); setForm(blank(accounts)); setError(''); setOpen(true); }
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
      setOpen(false); setEditing(null); await refresh(); await loadAccounts();
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
      await refresh(); await loadAccounts();
    } catch (err: any) { setError(err?.message || 'No pude quitar el movimiento.'); }
    finally { setBusy(null); }
  }

  return <div className="space-y-6 pb-10">
    <section className="lux-hero p-5 sm:p-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="lux-kicker">Libro personal</p><h1 className="lux-heading mt-2 text-3xl sm:text-4xl">Movimientos</h1><p className="lux-subtle mt-2 text-sm">Lapiz para editar. Papelera para quitar. En transferencias se corrigen las dos patas; deudas e historicos mantienen su flujo seguro.</p></div>
        <div className="grid gap-3 sm:min-w-[640px] sm:grid-cols-5"><Metric t="Ingresos" v={totals.income} /><Metric t="Gastos" v={totals.expense} /><Metric t="Historicos" v={totals.history} /><Metric t="Transferencias" v={totals.transfer} /><button className="premium-button rounded-3xl px-4 py-3 font-black" onClick={openCreate}><Plus className="mr-2 inline h-4 w-4" />Manual</button></div>
      </div>
    </section>
    {error && <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm font-bold text-amber-100">{error}</div>}
    <section className="lux-card p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="relative w-full lg:w-96"><Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-500" /><input className="lux-input w-full rounded-2xl py-3 pl-11 pr-4 text-sm outline-none" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar..." /></div><div className="flex flex-wrap items-center gap-2"><button className={`soft-button rounded-2xl px-4 py-2 font-black ${kind === 'all' ? 'text-blue-200' : ''}`} onClick={() => setKind('all')}>Todos</button><button className={`soft-button rounded-2xl px-4 py-2 font-black ${kind === 'income' ? 'text-green-200' : ''}`} onClick={() => setKind('income')}>Ingresos</button><button className={`soft-button rounded-2xl px-4 py-2 font-black ${kind === 'expense' ? 'text-red-200' : ''}`} onClick={() => setKind('expense')}>Salidas</button><div className="ml-auto flex items-center gap-1 rounded-2xl border border-slate-700/40 bg-slate-900/50 p-1 lg:ml-1"><button type="button" title="Vista tarjetas" onClick={() => setViewPersist('cards')} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black transition ${view === 'cards' ? 'bg-blue-500/20 text-blue-100' : 'text-slate-400 hover:text-slate-200'}`}><LayoutGrid className="h-4 w-4" />Tarjetas</button><button type="button" title="Vista tabla tipo Excel" onClick={() => setViewPersist('table')} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black transition ${view === 'table' ? 'bg-blue-500/20 text-blue-100' : 'text-slate-400 hover:text-slate-200'}`}><Table className="h-4 w-4" />Tabla</button></div></div></div></section>
    <section className="premium-panel rounded-[1.6rem] border border-slate-700/40 p-3">
      {loading ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-slate-500">No hay movimientos para esta vista.</div>
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
        <div className="grid gap-3">{filtered.map((tx) => { const reversed = Boolean(tx.isReversed || tx.reversalOf); return <article key={tx.id} className="rounded-3xl border border-slate-700/40 bg-slate-900/35 p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="font-black text-slate-100">{tx.description}</p><p className="text-xs text-slate-500">{tx.accountName}</p><div className="mt-2 flex gap-2"><Badge>{label(tx)}</Badge>{isProtectedTransaction(tx) && <Badge><ShieldCheck className="h-3 w-3" />Protegido</Badge>}{reversed && <Badge>Reversado</Badge>}</div></div><div className="flex items-center gap-3"><p className={tx.type === 'income' ? 'font-black text-green-300' : 'font-black text-red-300'}>{tx.type === 'income' ? '+' : '-'}{formatCOP(tx.amount)}</p><button disabled={reversed} onClick={() => openEdit(tx)} className="rounded-xl p-2 text-slate-400 hover:text-blue-300 disabled:opacity-30"><Pencil className="h-4 w-4" /></button><button disabled={reversed || busy === tx.id} onClick={() => removeTx(tx)} className="rounded-xl p-2 text-slate-400 hover:text-red-300 disabled:opacity-30">{busy === tx.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button></div></div></article>; })}</div>
      )}
    </section>
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xl"><form onSubmit={save} className="premium-panel w-full max-w-2xl rounded-[2rem] border border-slate-700/50 p-5"><h2 className="text-2xl font-black text-slate-100">{editing ? 'Editar' : 'Nuevo'}</h2><div className="mt-5 grid gap-4 sm:grid-cols-2">{!isTransfer(editing) && <><Select label="Tipo" value={form.type} onChange={(v) => setForm({ ...form, type: v as TransactionType, category: v === 'income' ? 'Ingreso' : 'Otros' })} options={[['income','Ingreso'],['expense','Gasto']]} /><Select label="Cuenta" value={form.accountId} onChange={(v) => setForm({ ...form, accountId: v })} options={accounts.map((a) => [a.id, a.name])} /></>}<Field label="Valor" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />{!isTransfer(editing) && <Select label="Categoria" value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={CATEGORIES.map((c) => [c, c])} />}<Field label="Descripcion" value={form.description} onChange={(v) => setForm({ ...form, description: v })} /><Field label="Fecha" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} /><Field label="Hora" type="time" value={form.time} onChange={(v) => setForm({ ...form, time: v })} /></div><div className="mt-6 flex justify-end gap-3"><button type="button" className="soft-button rounded-2xl px-4 py-2 font-black" onClick={() => setOpen(false)}>Cancelar</button><button type="submit" className="premium-button rounded-2xl px-4 py-2 font-black">Guardar</button></div></form></div>}
  </div>;
}

function Metric({ t, v }: { t: string; v: number }) { return <div className="rounded-3xl border border-blue-400/20 bg-blue-400/10 p-4"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-300">{t}</p><p className="mt-1 text-lg font-black text-slate-100">{formatCOP(v)}</p></div>; }
function Badge({ children }: { children: React.ReactNode }) { return <span className="inline-flex items-center gap-1 rounded-full border border-slate-600/30 bg-slate-800/50 px-3 py-1 text-[10px] font-bold text-slate-300">{children}</span>; }
function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) { return <label><span className="mb-1 block text-xs font-black text-slate-400">{label}</span><input className="lux-input w-full rounded-2xl px-4 py-3 text-sm outline-none" type={type} value={value} onChange={(e) => onChange(e.target.value)} /></label>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[][] }) { return <label><span className="mb-1 block text-xs font-black text-slate-400">{label}</span><select className="lux-input w-full rounded-2xl px-4 py-3 text-sm outline-none" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>; }

export default TransactionsPage;
