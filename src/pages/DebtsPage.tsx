import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { addDebt, deleteDebt, registerDebtPayment, updateDebt } from '../lib/firestore';
import { useDebts } from '../hooks/useDebts';
import type { Debt, DebtDirection } from '../types';
import { formatCOP } from '../types';
import { AlertCircle, CalendarClock, CheckCircle2, HandCoins, Loader2, Plus, Trash2, WalletCards } from 'lucide-react';

function parseDateInput(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00-05:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatInputDate(date?: Date | null): string {
  if (!date) return '';
  return date.toISOString().slice(0, 10);
}

function remaining(debt: Debt): number {
  return Math.max(0, debt.amountOriginal - debt.amountPaid);
}

function statusLabel(debt: Debt): string {
  if (debt.status === 'paid') return 'Pagada';
  if (debt.amountPaid > 0) return 'Parcial';
  return 'Pendiente';
}

const emptyForm = {
  direction: 'receivable' as DebtDirection,
  personName: '',
  amountOriginal: '',
  amountPaid: '0',
  description: '',
  notes: '',
  dueDate: '',
};

export function DebtsPage() {
  const { user } = useAuth();
  const { debts, loading, summary } = useDebts();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'open' | 'all' | 'receivable' | 'payable'>('open');
  const [error, setError] = useState<string | null>(null);

  const filteredDebts = useMemo(() => {
    return debts.filter((debt) => {
      if (filter === 'open') return debt.status !== 'paid';
      if (filter === 'receivable') return debt.direction === 'receivable';
      if (filter === 'payable') return debt.direction === 'payable';
      return true;
    });
  }, [debts, filter]);

  const handleCreate = async () => {
    if (!user) return;
    setError(null);

    const amountOriginal = Number(form.amountOriginal);
    const amountPaid = Number(form.amountPaid || 0);
    if (!form.personName.trim()) {
      setError('Escribe quién debe o a quién le debes.');
      return;
    }
    if (!amountOriginal || amountOriginal <= 0) {
      setError('Escribe un valor válido.');
      return;
    }

    setSaving(true);
    try {
      await addDebt(user.uid, {
        direction: form.direction,
        personName: form.personName.trim(),
        amountOriginal,
        amountPaid: Math.max(0, Math.min(amountOriginal, amountPaid)),
        currency: 'COP',
        description: form.description.trim() || (form.direction === 'receivable' ? 'Plata prestada' : 'Deuda por pagar'),
        notes: form.notes.trim() || undefined,
        dueDate: parseDateInput(form.dueDate),
        status: amountPaid >= amountOriginal ? 'paid' : amountPaid > 0 ? 'partial' : 'open',
        source: 'manual',
        confidence: 1,
        closedAt: amountPaid >= amountOriginal ? new Date() : null,
      });
      setForm(emptyForm);
    } catch (err: any) {
      setError(err?.message || 'No pude guardar la deuda.');
    } finally {
      setSaving(false);
    }
  };

  const handlePayment = async (debt: Debt) => {
    if (!user) return;
    const amount = Number(paymentAmount[debt.id] || 0);
    if (!amount || amount <= 0) {
      setError('Escribe cuánto abonaron o cuánto pagaste.');
      return;
    }

    setPayingId(debt.id);
    setError(null);
    try {
      await registerDebtPayment(user.uid, debt.id, amount);
      setPaymentAmount((prev) => ({ ...prev, [debt.id]: '' }));
    } catch (err: any) {
      setError(err?.message || 'No pude registrar el abono.');
    } finally {
      setPayingId(null);
    }
  };

  const handleMarkPaid = async (debt: Debt) => {
    if (!user) return;
    await updateDebt(user.uid, debt.id, {
      amountPaid: debt.amountOriginal,
      status: 'paid',
      closedAt: new Date(),
    });
  };

  const handleDelete = async (debt: Debt) => {
    if (!user) return;
    await deleteDebt(user.uid, debt.id);
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-8">
      <div className="glass rounded-3xl border border-slate-700/40 p-5 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-400">Control de deudas</p>
            <h1 className="mt-2 text-2xl font-black text-slate-100 sm:text-3xl">Deudas y plata prestada</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
              Lleva lo que te deben, lo que tú debes, notas, fechas prometidas de pago y abonos parciales.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:min-w-[520px]">
            <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-4">
              <p className="text-xs font-bold uppercase text-green-400">Te deben</p>
              <p className="mt-1 text-xl font-black text-slate-100">{formatCOP(summary.receivable)}</p>
            </div>
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
              <p className="text-xs font-bold uppercase text-red-400">Tú debes</p>
              <p className="mt-1 text-xl font-black text-slate-100">{formatCOP(summary.payable)}</p>
            </div>
            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4">
              <p className="text-xs font-bold uppercase text-blue-400">Balance neto</p>
              <p className="mt-1 text-xl font-black text-slate-100">{formatCOP(summary.net)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <div className="glass rounded-3xl border border-slate-700/40 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Plus className="h-5 w-5 text-blue-400" />
            <h2 className="font-bold text-slate-100">Añadir deuda</h2>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-900/70 p-1">
              <button
                onClick={() => setForm((prev) => ({ ...prev, direction: 'receivable' }))}
                className={`rounded-xl px-3 py-2 text-sm font-bold transition ${form.direction === 'receivable' ? 'bg-green-500/20 text-green-300' : 'text-slate-500'}`}
              >
                Me deben
              </button>
              <button
                onClick={() => setForm((prev) => ({ ...prev, direction: 'payable' }))}
                className={`rounded-xl px-3 py-2 text-sm font-bold transition ${form.direction === 'payable' ? 'bg-red-500/20 text-red-300' : 'text-slate-500'}`}
              >
                Yo debo
              </button>
            </div>

            <input className="w-full rounded-2xl border border-slate-700/50 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/40" placeholder="Persona o entidad" value={form.personName} onChange={(e) => setForm((prev) => ({ ...prev, personName: e.target.value }))} />
            <input className="w-full rounded-2xl border border-slate-700/50 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/40" placeholder="Valor total" type="number" value={form.amountOriginal} onChange={(e) => setForm((prev) => ({ ...prev, amountOriginal: e.target.value }))} />
            <input className="w-full rounded-2xl border border-slate-700/50 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/40" placeholder="Descripción: almuerzo, préstamo, arriendo..." value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
            <input className="w-full rounded-2xl border border-slate-700/50 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/40" placeholder="Fecha prometida de pago" type="date" value={form.dueDate} onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))} />
            <textarea className="min-h-24 w-full resize-none rounded-2xl border border-slate-700/50 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/40" placeholder="Notas opcionales" value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />

            {error && <div className="flex gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}

            <button onClick={handleCreate} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-500 disabled:bg-slate-700">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Guardar deuda
            </button>
          </div>
        </div>

        <div className="glass rounded-3xl border border-slate-700/40 p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-bold text-slate-100">Listado</h2>
              <p className="text-xs text-slate-500">{summary.openCount} pendientes abiertas o parciales</p>
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {(['open', 'all', 'receivable', 'payable'] as const).map((item) => (
                <button key={item} onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-bold transition ${filter === item ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                  {item === 'open' ? 'Pendientes' : item === 'all' ? 'Todas' : item === 'receivable' ? 'Me deben' : 'Yo debo'}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-blue-400" /></div>
          ) : filteredDebts.length === 0 ? (
            <div className="flex min-h-60 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-700/60 p-8 text-center">
              <WalletCards className="mb-3 h-10 w-10 text-slate-600" />
              <p className="font-bold text-slate-300">No hay deudas en esta vista</p>
              <p className="mt-1 text-sm text-slate-500">Puedes crearlas manualmente o decirle al bot: “Juan me debe 50 mil”.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredDebts.map((debt) => {
                const rest = remaining(debt);
                return (
                  <div key={debt.id} className="rounded-3xl border border-slate-700/50 bg-slate-900/50 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${debt.direction === 'receivable' ? 'bg-green-500/10 text-green-300' : 'bg-red-500/10 text-red-300'}`}>
                            {debt.direction === 'receivable' ? 'Te deben' : 'Tú debes'}
                          </span>
                          <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-300">{statusLabel(debt)}</span>
                        </div>
                        <h3 className="mt-2 truncate text-lg font-black text-slate-100">{debt.personName}</h3>
                        <p className="text-sm text-slate-400">{debt.description}</p>
                        {debt.notes && <p className="mt-2 rounded-2xl bg-slate-950/60 p-3 text-sm text-slate-300">{debt.notes}</p>}
                        {debt.dueDate && (
                          <p className="mt-2 flex items-center gap-2 text-xs text-amber-300"><CalendarClock className="h-4 w-4" /> Fecha pactada: {debt.dueDate.toLocaleDateString('es-CO')}</p>
                        )}
                      </div>
                      <div className="text-left lg:text-right">
                        <p className="text-xs uppercase text-slate-500">Saldo pendiente</p>
                        <p className={`text-2xl font-black ${debt.direction === 'receivable' ? 'text-green-300' : 'text-red-300'}`}>{formatCOP(rest)}</p>
                        <p className="text-xs text-slate-500">Total: {formatCOP(debt.amountOriginal)} · Abonado: {formatCOP(debt.amountPaid)}</p>
                      </div>
                    </div>

                    {debt.status !== 'paid' && (
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                        <input className="min-w-0 flex-1 rounded-2xl border border-slate-700/50 bg-slate-950/70 px-4 py-2.5 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/40" placeholder="Abono o pago recibido" type="number" value={paymentAmount[debt.id] || ''} onChange={(e) => setPaymentAmount((prev) => ({ ...prev, [debt.id]: e.target.value }))} />
                        <button onClick={() => handlePayment(debt)} disabled={payingId === debt.id} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-500 disabled:bg-slate-700">
                          {payingId === debt.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}
                          Abonar
                        </button>
                        <button onClick={() => handleMarkPaid(debt)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-green-600/80 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-green-500">
                          <CheckCircle2 className="h-4 w-4" /> Pagada
                        </button>
                      </div>
                    )}

                    <div className="mt-3 flex justify-end">
                      <button onClick={() => handleDelete(debt)} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-slate-500 transition hover:bg-red-500/10 hover:text-red-300">
                        <Trash2 className="h-4 w-4" /> Eliminar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
