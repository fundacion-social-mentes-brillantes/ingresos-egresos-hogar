import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTransactions } from '../hooks/useTransactions';
import { getAllTransactions } from '../lib/firestore';
import { transferBetweenAccountsSafe } from '../lib/transferOperations';
import { confirmRealBalance } from '../lib/accountingOperations';
import { buildAccountingLedger, parseCurrencyInput } from '../lib/accounting';
import { formatCOP } from '../types';
import type { Transaction } from '../types';
import { AccountBrandMark } from '../components/visual/AccountBrandMark';
import { EmptyState } from '../components/visual/EmptyState';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
import { AlertCircle, AlertTriangle, ArrowRightLeft, CheckCircle2, ReceiptText, WalletCards } from 'lucide-react';
import clsx from 'clsx';

export function AccountsPage() {
  const { user } = useAuth();
  const { accounts, loading, refresh } = useTransactions();
  // El cuadre/conciliacion DEBE calcularse sobre el historial completo, no sobre
  // los ultimos 500 movimientos del listener: con un set truncado el saldo
  // calculado salia bajo y mostraba descuadres que no existian.
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const loadAllTransactions = useCallback(async () => {
    if (!user) { setTransactions([]); return; }
    setTransactions(await getAllTransactions(user.uid));
  }, [user]);
  useEffect(() => { loadAllTransactions().catch((error) => console.error('No pude cargar el historial completo de movimientos', error)); }, [loadAllTransactions]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transferFrom, setTransferFrom] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDescription, setTransferDescription] = useState('Transferencia entre cuentas');
  const [transferError, setTransferError] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [realBalanceInput, setRealBalanceInput] = useState('');
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);

  const ledger = useMemo(() => buildAccountingLedger(accounts, transactions), [accounts, transactions]);

  useEffect(() => {
    if (!selectedAccountId && accounts.length > 0) setSelectedAccountId(accounts[0].id);
  }, [accounts, selectedAccountId]);

  const selectedAccount = useMemo(() => accounts.find((account) => account.id === selectedAccountId) || null, [accounts, selectedAccountId]);
  const selectedStats = selectedAccount ? ledger.byAccount[selectedAccount.id] : null;
  const selectedTransactions = useMemo(() => {
    if (!selectedAccount) return [];
    return transactions
      .filter((tx) => tx.accountId === selectedAccount.id || tx.accountName === selectedAccount.name)
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [transactions, selectedAccount]);

  const accountOptions = useMemo(() => [
    { value: '', label: 'Seleccionar cuenta' },
    ...accounts.filter((account) => account.active).map((account) => ({ value: account.id, label: `${account.name} (${formatCOP(account.currentBalance)})` })),
  ], [accounts]);

  const handleTransfer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    setTransferError(null);
    setIsTransferring(true);
    try {
      const amount = parseCurrencyInput(transferAmount);
      if (transferFrom === transferTo) throw new Error('Las cuentas de origen y destino deben ser distintas.');
      await transferBetweenAccountsSafe(user.uid, { fromAccountId: transferFrom, toAccountId: transferTo, amount, description: transferDescription });
      setShowTransferForm(false);
      setTransferFrom('');
      setTransferTo('');
      setTransferAmount('');
      setTransferDescription('Transferencia entre cuentas');
      await refresh();
      await loadAllTransactions();
    } catch (error: any) {
      setTransferError(error?.message || 'No pude hacer la transferencia.');
    } finally {
      setIsTransferring(false);
    }
  };

  const handleConfirmRealBalance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !selectedAccount) return;
    setReconciling(true);
    setReconcileMessage(null);
    try {
      const result = await confirmRealBalance(user.uid, selectedAccount.id, realBalanceInput);
      setReconcileMessage(result.estado === 'cuadra' ? 'Saldo real confirmado: la cuenta cuadra.' : `Saldo real confirmado: descuadre de ${formatCOP(Math.abs(result.diferencia))}.`);
      setRealBalanceInput('');
      await refresh();
      await loadAllTransactions();
    } catch (error: any) {
      setReconcileMessage(error?.message || 'No pude confirmar el saldo real.');
    } finally {
      setReconciling(false);
    }
  };

  if (loading && accounts.length === 0) {
    return <div className="flex h-64 items-center justify-center"><div className="premium-icon h-16 w-16 text-blue-200"><WalletCards className="h-8 w-8 animate-pulse" /></div></div>;
  }

  return (
    <div className="space-y-6 pb-24">
      <section className="lux-hero relative p-5 sm:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="lux-kicker">Auditoría contable</p>
            <h1 className="lux-heading mt-2 text-3xl sm:text-4xl">Cuentas</h1>
            <p className="lux-subtle mt-2 max-w-2xl text-sm">Saldo calculado, saldo real confirmado, conciliación, transferencias y movimientos separados por naturaleza contable.</p>
          </div>
          <Button onClick={() => setShowTransferForm((value) => !value)} className="gap-2"><ArrowRightLeft className="h-4 w-4" />{showTransferForm ? 'Ver cuadre' : 'Transferir'}</Button>
        </div>
      </section>

      {accounts.length === 0 ? <section className="p-5"><EmptyState asset="categories" title="No hay cuentas creadas" description="Las cuentas que crees aparecerán aquí para su auditoría." /></section> : (
        <div className="grid gap-6 px-4 sm:px-6 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-4">
            {accounts.map((account) => {
              const stats = ledger.byAccount[account.id];
              const isSelected = selectedAccountId === account.id;
              const reconciled = stats.saldoRealConfirmado;
              const cuadra = reconciled && stats.estado === 'cuadra';
              return (
                <button key={account.id} onClick={() => setSelectedAccountId(account.id)} className={clsx('w-full rounded-3xl border p-4 text-left transition', isSelected ? 'border-blue-400/40 bg-blue-500/10' : 'border-slate-700/40 bg-slate-900/35 hover:bg-slate-800/50')}>
                  <div className="flex items-start justify-between gap-3"><AccountBrandMark type={account.type} name={account.name} size="md" showLabel />{!account.active && <span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] font-black text-slate-400">INACTIVA</span>}</div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Calculado</p><p className="font-black text-slate-100">{formatCOP(stats.saldoFisicoCalculado)}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Real</p><p className="font-black text-slate-100">{formatCOP(stats.saldoRealIngresado)}</p></div>
                  </div>
                  <div className="mt-3 rounded-2xl border border-slate-700/30 bg-slate-950/40 p-3 space-y-1">
                    <Row label="Gastos presentes" value={`-${formatCOP(stats.gastosReportablesOPresentes)}`} tone="red" />
                    <Row label="Históricos/no reportables" value={`-${formatCOP(stats.gastosHistoricosNoReportables)}`} tone="purple" />
                    <Row label="Salidas físicas" value={`-${formatCOP(stats.salidasFisicasTotales)}`} tone="amber" />
                  </div>
                  <div className={clsx('mt-3 flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-bold', !reconciled ? 'border border-slate-600/30 bg-slate-700/20 text-slate-300' : cuadra ? 'border border-green-500/20 bg-green-500/10 text-green-300' : 'border border-orange-500/20 bg-orange-500/10 text-orange-300')}>
                    {cuadra ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    <span>{!reconciled ? 'Pendiente de conciliación' : cuadra ? 'Cuadra' : `Descuadre: ${formatCOP(Math.abs(stats.diferenciaConciliacion))}`}</span>
                  </div>
                </button>
              );
            })}
          </aside>

          <main className="premium-panel min-h-[720px] overflow-hidden rounded-[2rem] border border-slate-700/40">
            {showTransferForm ? (
              <form onSubmit={handleTransfer} className="space-y-4 p-6">
                <h2 className="text-xl font-black text-slate-100">Transferir dinero</h2>
                <p className="text-sm text-slate-400">Una transferencia mueve dos cuentas, pero no suma como ingreso ni gasto global.</p>
                {transferError && <div className="flex gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-300"><AlertCircle className="h-5 w-5" /><p className="text-sm">{transferError}</p></div>}
                <div className="grid gap-4 sm:grid-cols-2"><Select label="Cuenta origen" value={transferFrom} onChange={(e) => setTransferFrom(e.target.value)} required options={accountOptions} /><Select label="Cuenta destino" value={transferTo} onChange={(e) => setTransferTo(e.target.value)} required options={accountOptions} /></div>
                <Input label="Monto" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} placeholder="$45.000" required />
                <Input label="Descripción" value={transferDescription} onChange={(e) => setTransferDescription(e.target.value)} />
                <div className="flex justify-end gap-3"><Button type="button" variant="ghost" onClick={() => setShowTransferForm(false)}>Cancelar</Button><Button type="submit" loading={isTransferring} className="gap-2"><ArrowRightLeft className="h-4 w-4" />Confirmar</Button></div>
              </form>
            ) : selectedAccount && selectedStats ? (
              <div className="flex h-full flex-col">
                <div className="border-b border-slate-700/40 bg-slate-900/50 p-5">
                  <h2 className="text-lg font-black text-slate-100">Detalle de cuadre: {selectedAccount.name}</h2>
                  <p className="mt-1 text-xs text-slate-400">{selectedTransactions.length} movimientos · {selectedStats.saldoRealConfirmado ? 'saldo real confirmado' : 'saldo real pendiente de confirmar'}</p>
                </div>
                <section className="grid gap-3 border-b border-slate-700/40 bg-slate-950/25 p-4 sm:grid-cols-2 xl:grid-cols-3">
                  <Card label="Saldo inicial" value={selectedStats.saldoInicial} />
                  <Card label="Ingresos físicos" value={selectedStats.ingresosFisicos} tone="green" />
                  <Card label="Gastos presentes" value={selectedStats.gastosReportablesOPresentes} tone="red" />
                  <Card label="Históricos/no reportables" value={selectedStats.gastosHistoricosNoReportables} tone="purple" />
                  <Card label="Saldo calculado" value={selectedStats.saldoFisicoCalculado} tone="blue" />
                  <Card label="Diferencia" value={selectedStats.diferenciaConciliacion} tone={selectedStats.estado === 'cuadra' ? 'green' : 'amber'} />
                </section>
                <form onSubmit={handleConfirmRealBalance} className="grid gap-3 border-b border-slate-700/40 p-4 md:grid-cols-[1fr_auto] md:items-end">
                  <Input label="Confirmar saldo real observado" value={realBalanceInput} onChange={(e) => setRealBalanceInput(e.target.value)} placeholder="Ej: 2.912.319" />
                  <Button type="submit" loading={reconciling}>Confirmar saldo real</Button>
                  {reconcileMessage && <p className="md:col-span-2 rounded-2xl border border-blue-400/20 bg-blue-400/10 px-4 py-3 text-sm font-bold text-blue-100">{reconcileMessage}</p>}
                </form>
                <section className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                  {selectedTransactions.length === 0 ? <EmptyState asset="transactions" title="Esta cuenta aún no tiene movimientos" description="Los movimientos asociados a esta cuenta aparecerán aquí." /> : <div className="grid gap-3">{selectedTransactions.map((tx) => <article key={tx.id} className="rounded-2xl border border-slate-700/40 bg-slate-900/30 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black text-slate-100">{tx.description}</p><p className="mt-1 text-xs text-slate-500">{tx.accountName}</p></div><p className={clsx('text-sm font-black', tx.type === 'income' ? 'text-green-300' : 'text-red-300')}>{tx.type === 'income' ? '+' : '-'}{formatCOP(tx.amount)}</p></div><div className="mt-3 flex flex-wrap gap-2"><span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600/30 bg-slate-800/50 px-2 py-1 text-[10px] font-bold text-slate-300"><ReceiptText className="h-3 w-3" />{tx.category}</span>{tx.excludeFromReports && <span className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-[10px] font-bold text-purple-300">No reportable</span>}{tx.transferId && <span className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-bold text-blue-300">Transferencia</span>}</div></article>)}</div>}
                </section>
              </div>
            ) : <div className="flex h-full items-center justify-center p-8 text-sm text-slate-500">Selecciona una cuenta</div>}
          </main>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone: 'red' | 'purple' | 'amber' }) {
  const color = tone === 'red' ? 'text-red-300' : tone === 'purple' ? 'text-purple-300' : 'text-amber-300';
  return <div className="flex items-center justify-between text-xs"><span className="text-slate-400">{label}</span><span className={clsx('font-bold', color)}>{value}</span></div>;
}

function Card({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'green' | 'red' | 'purple' | 'blue' | 'amber' }) {
  const classes: Record<string, string> = { slate: 'border-slate-700/40 bg-slate-900/40 text-slate-500', green: 'border-green-500/20 bg-green-500/10 text-green-300', red: 'border-red-500/20 bg-red-500/10 text-red-300', purple: 'border-purple-500/20 bg-purple-500/10 text-purple-300', blue: 'border-blue-500/20 bg-blue-500/10 text-blue-300', amber: 'border-amber-500/20 bg-amber-500/10 text-amber-300' };
  return <div className={clsx('rounded-2xl border p-3', classes[tone])}><p className="text-[10px] font-black uppercase tracking-[0.16em]">{label}</p><p className="font-black text-slate-100">{formatCOP(value)}</p></div>;
}
