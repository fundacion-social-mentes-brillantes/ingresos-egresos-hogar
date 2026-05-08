import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { addDebt, deleteDebt, registerDebtPayment, updateDebt } from '../lib/firestore';
import { useDebts } from '../hooks/useDebts';
import type { Debt, DebtDirection } from '../types';
import { formatCOP } from '../types';
import { EmptyState } from '../components/visual/EmptyState';
import { AlertCircle, CalendarClock, CheckCircle2, HandCoins, Loader2, Plus, Trash2, WalletCards } from 'lucide-react';

function parseDateInput(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00-05:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function remaining(debt: Debt): number {
  return Math.max(0, debt.amountOriginal - debt.amountPaid);
}

function statusLabel(debt: Debt): string {
  if (debt.status === 'paid') return 'Pagada';
  if (debt.amountPaid > 0) return 'Parcial';
  return 'Pendiente';
}

function statusClass(debt: Debt): string {
  if (debt.status === 'paid') return 'border-green-400/25 bg-green-400/10 text-green-300';
  if (debt.amountPaid > 0) return 'border-amber-400/25 bg-amber-400/10 text-amber-300';
  return 'border-blue-400/25 bg-blue-400/10 text-blue-300';
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

  const filteredDebts = useMemo(() => debts.filter((debt) => {
    if (filter === 'open') return debt.status !== 'paid';
    if (filter === 'receivable') return debt.direction === 'receivable';
    if (filter === 'payable') return debt.direction === 'payable';
    return true;
  }), [debts, filter]);

  const handleCreate = async () => {
    if (!user) return;
    setError(null);

    const amountOriginal = Number(form.amountOriginal);
    const amountPaid = Number(form.amountPaid || 0);
    if (!form.personName.trim()) {
      setError('Escribe quien debe o a quien le debes.');
      return;
    }
    if (!amountOriginal || amountOriginal <= 0) {
      setError('Escribe un valor valido.');
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
      setError('Escribe cuanto abonaron o cuanto pagaste.');
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
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-10">
      <section className="lux-hero relative p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="lux-kicker">Control de obligaciones</p>
            <h1 className="lux-heading mt-2 text-3xl sm:text-4xl">Deudas y plata prestada</h1>
            <p className="lux-subtle mt-2 max-w-2xl text-sm">Separacion clara entre lo que te deben, lo que debes, abonos parciales y cierres seguros.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[520px]">
            <div className="rounded-3xl border border-green-500/20 bg-green-500/10 p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-green-300">Te deben</p>
              <p className="mt-1 text-xl font-black text-slate-100">{formatCOP(summary.receivable)}</p>
            </div>
            <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-red-300">Tu debes</p>
              <p className="mt-1 text-xl font-black text-slate-100">{formatCOP(summary.payable)}</p>
            </div>
            <div className="rounded-3xl border border-blue-500/20 bg-blue-500/10 p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-300">Balance neto</p>
              <p className="mt-1 text-xl font-black text-slate-100">{formatCOP(summary.net)}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[390px_1fr]">
        <section className="lux-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <div className="premium-icon h-10 w-10 text-blue-200">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-black text-slate-100">Añadir deuda</h2>
              <p className="text-xs text-slate-500">Registro manual rapido</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-700/40 bg-slate-900/50 p-1">
              <button
                onClick={() => setForm((prev) => ({ ...prev, direction: 'receivable' }))}
                className={`rounded-xl px-3 py-2 text-sm font-black transition ${form.direction === 'receivable' ? 'bg-green-500/20 text-green-300 shadow-lg shadow-green-500/10' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Me deben
              </button>
              <button
                onClick={() => setForm((prev) => ({ ...prev, direction: 'payable' }))}
                className={`rounded-xl px-3 py-2 text-sm font-black transition ${form.direction === 'payable' ? 'bg-red-500/20 text-red-300 shadow-lg shadow-red-500/10' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Yo debo
              </button>
            </div>

            <input className="lux-input w-full rounded-2xl px-4 py-3 text-sm outline-none" placeholder="Persona o entidad" value={form.personName} onChange={(event) => setForm((prev) => ({ ...prev, personName: event.target.value }))} />
            <input className="lux-input w-full rounded-2xl px-4 py-3 text-sm outline-none" placeholder="Valor total" type="number" value={form.amountOriginal} onChange={(event) => setForm((prev) => ({ ...prev, amountOriginal: event.target.value }))} />
            <input className="lux-input w-full rounded-2xl px-4 py-3 text-sm outline-none" placeholder="Descripcion: almuerzo, prestamo, arriendo..." value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
            <input className="lux-input w-full rounded-2xl px-4 py-3 text-sm outline-none" placeholder="Fecha prometida de pago" type="date" value={form.dueDate} onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))} />
            <textarea className="lux-input min-h-24 w-full resize-none rounded-2xl px-4 py-3 text-sm outline-none" placeholder="Notas opcionales" value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />

            {error && (
              <div className="flex gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <button onClick={handleCreate} disabled={saving} className="premium-button flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black transition disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Guardar deuda
            </button>
          </div>
        </section>

        <section className="lux-card p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-100">Listado</h2>
              <p className="text-xs text-slate-500">{summary.openCount} pendientes abiertas o parciales</p>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {(['open', 'all', 'receivable', 'payable'] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => setFilter(item)}
                  className={`whitespace-nowrap rounded-2xl px-4 py-2 text-xs font-black transition ${filter === item ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'soft-button'}`}
                >
                  {item === 'open' ? 'Pendientes' : item === 'all' ? 'Todas' : item === 'receivable' ? 'Me deben' : 'Yo debo'}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-blue-400" />
            </div>
          ) : filteredDebts.length === 0 ? (
            <EmptyState
              asset="debts"
              title="No hay deudas en esta vista"
              description="Puedes crearlas manualmente o decirle al copiloto: Juan me debe 50 mil."
            />
          ) : (
            <div className="grid gap-3">
              {filteredDebts.map((debt) => {
                const rest = remaining(debt);
                const progress = debt.amountOriginal > 0 ? Math.min(100, (debt.amountPaid / debt.amountOriginal) * 100) : 0;
                return (
                  <article key={debt.id} className="rounded-3xl border border-slate-700/50 bg-slate-900/40 p-4 shadow-lg shadow-black/10">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-3 py-1 text-xs font-black ${debt.direction === 'receivable' ? 'border-green-400/25 bg-green-400/10 text-green-300' : 'border-red-400/25 bg-red-400/10 text-red-300'}`}>
                            {debt.direction === 'receivable' ? 'Te deben' : 'Tu debes'}
                          </span>
                          <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusClass(debt)}`}>{statusLabel(debt)}</span>
                        </div>
                        <h3 className="mt-3 truncate text-xl font-black text-slate-100">{debt.personName}</h3>
                        <p className="text-sm text-slate-400">{debt.description}</p>
                        {debt.notes && <p className="mt-3 rounded-2xl border border-slate-700/40 bg-slate-950/50 p-3 text-sm text-slate-300">{debt.notes}</p>}
                        {debt.dueDate && (
                          <p className="mt-3 flex items-center gap-2 text-xs font-bold text-amber-300">
                            <CalendarClock className="h-4 w-4" />
                            Fecha pactada: {debt.dueDate.toLocaleDateString('es-CO')}
                          </p>
                        )}
                      </div>
                      <div className="min-w-[190px] text-left lg:text-right">
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Saldo pendiente</p>
                        <p className={`mt-1 text-3xl font-black ${debt.direction === 'receivable' ? 'text-green-300' : 'text-red-300'}`}>{formatCOP(rest)}</p>
                        <p className="mt-1 text-xs text-slate-500">Total: {formatCOP(debt.amountOriginal)} · Abonado: {formatCOP(debt.amountPaid)}</p>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800/70">
                          <div className="h-full rounded-full bg-gradient-to-r from-blue-400 to-green-300" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    </div>

                    {debt.status !== 'paid' && (
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                        <input className="lux-input min-w-0 flex-1 rounded-2xl px-4 py-2.5 text-sm outline-none" placeholder="Abono o pago recibido" type="number" value={paymentAmount[debt.id] || ''} onChange={(event) => setPaymentAmount((prev) => ({ ...prev, [debt.id]: event.target.value }))} />
                        <button onClick={() => handlePayment(debt)} disabled={payingId === debt.id} className="premium-button inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-black transition disabled:opacity-50">
                          {payingId === debt.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}
                          Abonar
                        </button>
                        <button onClick={() => handleMarkPaid(debt)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-green-400/25 bg-green-500/15 px-4 py-2.5 text-sm font-black text-green-200 transition hover:bg-green-500/20">
                          <CheckCircle2 className="h-4 w-4" />
                          Pagada
                        </button>
                      </div>
                    )}

                    <div className="mt-3 flex justify-end">
                      <button onClick={() => handleDelete(debt)} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black text-slate-500 transition hover:bg-red-500/10 hover:text-red-300">
                        <Trash2 className="h-4 w-4" />
                        Eliminar
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
