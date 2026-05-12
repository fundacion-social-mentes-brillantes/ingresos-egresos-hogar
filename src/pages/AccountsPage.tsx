import { useState, useMemo, useEffect } from 'react';
import { useTransactions } from '../hooks/useTransactions';
import { AccountBrandMark } from '../components/visual/AccountBrandMark';
import { EmptyState } from '../components/visual/EmptyState';
import { formatCOP } from '../types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { WalletCards, Bot, User, ReceiptText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { transferBetweenAccounts } from '../lib/firestore';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
import { ArrowRightLeft, AlertCircle } from 'lucide-react';
import clsx from 'clsx';

export function AccountsPage() {
  const { transactions, accounts, loading } = useTransactions();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const { user } = useAuth();
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferFrom, setTransferFrom] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDescription, setTransferDescription] = useState('Transferencia entre cuentas');

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setTransferError(null);
    setIsTransferring(true);
    
    try {
      const amountNum = Number(transferAmount.replace(/\D/g, ''));
      if (amountNum <= 0) throw new Error('El monto debe ser mayor a cero');
      if (transferFrom === transferTo) throw new Error('Las cuentas de origen y destino deben ser distintas');
      
      const fromAcc = accounts.find(a => a.id === transferFrom);
      const toAcc = accounts.find(a => a.id === transferTo);
      if (!fromAcc || !toAcc) throw new Error('Cuentas no encontradas');
      
      await transferBetweenAccounts(user.uid, {
        fromAccountId: transferFrom,
        toAccountId: transferTo,
        amount: amountNum,
        description: transferDescription
      });
      
      setShowTransferForm(false);
      setTransferAmount('');
      setTransferFrom('');
      setTransferTo('');
      setTransferDescription('Transferencia entre cuentas');
    } catch (err: any) {
      setTransferError(err.message || 'Error al transferir');
    } finally {
      setIsTransferring(false);
    }
  };


  useEffect(() => {
    if (!selectedAccountId && accounts.length > 0) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  const selectedAccount = useMemo(() => {
    return accounts.find((a) => a.id === selectedAccountId) || null;
  }, [accounts, selectedAccountId]);

  const accountStats = useMemo(() => {
    const stats: Record<string, { income: number; expense: number; txCount: number; calculatedBalance: number; difference: number }> = {};
    
    accounts.forEach((acc) => {
      const accountTxs = transactions.filter((tx) => tx.accountId === acc.id || tx.accountName === acc.name);
      const income = accountTxs.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + tx.amount, 0);
      const expense = accountTxs.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + tx.amount, 0);
      const calculatedBalance = acc.initialBalance + income - expense;
      const difference = acc.currentBalance - calculatedBalance;
      
      stats[acc.id] = {
        income,
        expense,
        txCount: accountTxs.length,
        calculatedBalance,
        difference
      };
    });
    
    return stats;
  }, [accounts, transactions]);

  const selectedTransactions = useMemo(() => {
    if (!selectedAccount) return [];
    return transactions
      .filter((tx) => tx.accountId === selectedAccount.id || tx.accountName === selectedAccount.name)
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [transactions, selectedAccount]);

  if (loading && accounts.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="premium-icon h-16 w-16 text-blue-200">
          <WalletCards className="h-8 w-8 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      <section className="lux-hero relative p-5 sm:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="lux-kicker">Auditoría visual</p>
            <h1 className="lux-heading mt-2 text-3xl sm:text-4xl">Cuentas</h1>
            <p className="lux-subtle mt-2 max-w-2xl text-sm">Consulta saldos y movimientos por cuenta. Mostrando los últimos movimientos cargados.</p>
          </div>
          <div className="premium-icon h-16 w-16 text-blue-200">
            <WalletCards className="h-8 w-8" />
          </div>
        </div>
      </section>

      {accounts.length === 0 ? (
        <section className="p-5">
          <EmptyState asset="categories" title="No hay cuentas creadas" description="Las cuentas que crees aparecerán aquí para su auditoría." />
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[350px_1fr] xl:grid-cols-[400px_1fr] px-4 sm:px-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">Tus Cuentas</h2>
              <Button 
                onClick={() => setShowTransferForm(!showTransferForm)}
                variant="primary"
                size="sm"
                className="gap-2"
              >
                <ArrowRightLeft className="h-4 w-4" />
                {showTransferForm ? 'Cancelar' : 'Transferir'}
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              {accounts.map((account) => {
                const isSelected = selectedAccountId === account.id;
                const stats = accountStats[account.id];
                const cuadra = Math.abs(stats.difference) <= 1;

                return (
                  <button
                    key={account.id}
                    onClick={() => setSelectedAccountId(account.id)}
                    className={clsx(
                      'text-left w-full rounded-3xl border p-4 transition-all duration-200',
                      isSelected 
                        ? 'border-blue-400/40 bg-blue-500/10 shadow-lg shadow-blue-500/5' 
                        : 'border-slate-700/40 bg-slate-900/35 hover:bg-slate-800/50'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <AccountBrandMark type={account.type} name={account.name} size="md" showLabel />
                      {!account.active && (
                        <span className="rounded-full border border-slate-600/30 bg-slate-800/50 px-2 py-1 text-[10px] font-black text-slate-400">
                          INACTIVA
                        </span>
                      )}
                    </div>
                    
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Saldo actual</p>
                        <p className={clsx('text-lg font-black', isSelected ? 'text-blue-200' : 'text-slate-100')}>
                          {formatCOP(account.currentBalance)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Movimientos</p>
                        <p className="text-lg font-black text-slate-300">{stats.txCount}</p>
                      </div>
                    </div>

                    <div className="mt-3 rounded-2xl border border-slate-700/30 bg-slate-950/40 p-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Ingresos</span>
                        <span className="font-bold text-green-300">+{formatCOP(stats.income)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs">
                        <span className="text-slate-400">Gastos</span>
                        <span className="font-bold text-red-300">-{formatCOP(stats.expense)}</span>
                      </div>
                    </div>

                    <div className={clsx(
                      'mt-3 flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-bold',
                      cuadra 
                        ? 'bg-green-500/10 text-green-300 border border-green-500/20' 
                        : 'bg-orange-500/10 text-orange-300 border border-orange-500/20'
                    )}>
                      {cuadra ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                      <span>
                        {cuadra ? 'Cuadra' : `Revisar diferencia: ${formatCOP(Math.abs(stats.difference))}`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="premium-panel flex flex-col rounded-[2rem] border border-slate-700/40 overflow-hidden lg:h-[800px]">
            
            {showTransferForm ? (
              <div className="p-6">
                <div className="mb-6">
                  <h2 className="text-xl font-black text-slate-100">Transferir Dinero</h2>
                  <p className="mt-1 text-sm text-slate-400">Mueve dinero entre tus cuentas sin afectar los reportes de ingresos y gastos.</p>
                </div>
                
                <form onSubmit={handleTransfer} className="space-y-4">
                  {transferError && (
                    <div className="flex items-start gap-3 rounded-xl bg-red-500/10 p-4 border border-red-500/20 text-red-300">
                      <AlertCircle className="h-5 w-5 shrink-0" />
                      <p className="text-sm">{transferError}</p>
                    </div>
                  )}
                  
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select
                      label="Cuenta origen (Retiro)"
                      value={transferFrom}
                      onChange={(e) => setTransferFrom(e.target.value)}
                      required
                      options={[
                        { value: '', label: 'Seleccionar cuenta' },
                        ...accounts.filter(a => a.active).map(a => ({
                          value: a.id,
                          label: `${a.name} (${formatCOP(a.currentBalance)})`
                        }))
                      ]}
                    />
                    
                    <Select
                      label="Cuenta destino (Ingreso)"
                      value={transferTo}
                      onChange={(e) => setTransferTo(e.target.value)}
                      required
                      options={[
                        { value: '', label: 'Seleccionar cuenta' },
                        ...accounts.filter(a => a.active).map(a => ({
                          value: a.id,
                          label: `${a.name} (${formatCOP(a.currentBalance)})`
                        }))
                      ]}
                    />
                  </div>
                  
                  <Input
                    label="Monto a transferir"
                    type="text"
                    value={transferAmount}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '');
                      setTransferAmount(value ? formatCOP(Number(value)) : '');
                    }}
                    placeholder="$ 0"
                    required
                  />
                  
                  <Input
                    label="Descripción (opcional)"
                    value={transferDescription}
                    onChange={(e) => setTransferDescription(e.target.value)}
                    placeholder="Ej: Pasar dinero a Nequi"
                  />
                  
                  <div className="pt-4 flex items-center gap-3 justify-end">
                    <Button type="button" variant="ghost" onClick={() => setShowTransferForm(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" variant="primary" disabled={isTransferring} className="gap-2">
                      <ArrowRightLeft className="h-4 w-4" />
                      {isTransferring ? 'Transfiriendo...' : 'Confirmar Transferencia'}
                    </Button>
                  </div>
                </form>
              </div>
            ) : selectedAccount ? (

              <>
                <div className="border-b border-slate-700/40 bg-slate-900/50 p-5">
                  <h2 className="text-lg font-black text-slate-100">
                    Movimientos de {selectedAccount.name}
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    {selectedTransactions.length} movimientos encontrados
                  </p>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                  {selectedTransactions.length === 0 ? (
                    <EmptyState 
                      asset="transactions" 
                      title="Esta cuenta aún no tiene movimientos" 
                      description="Los movimientos asociados a esta cuenta aparecerán aquí." 
                    />
                  ) : (
                    <div className="grid gap-3">
                      {selectedTransactions.map((tx) => (
                        <article key={tx.id} className="rounded-2xl border border-slate-700/40 bg-slate-900/30 p-4 transition hover:bg-slate-800/40">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', tx.source === 'bot' ? 'border-blue-400/25 bg-blue-400/10 text-blue-300' : 'border-slate-600/30 bg-slate-800/40 text-slate-500')}>
                                {tx.source === 'bot' ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-black text-slate-100">{tx.description}</p>
                                <p className="mt-1 text-xs text-slate-500">{format(tx.date, 'dd MMM yyyy, HH:mm', { locale: es })}</p>
                              </div>
                            </div>
                            <p className={clsx('shrink-0 text-sm font-black', tx.type === 'income' ? 'text-green-300' : 'text-red-300')}>
                              {tx.type === 'income' ? '+' : '-'}{formatCOP(tx.amount)}
                            </p>
                          </div>
                          
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600/30 bg-slate-800/50 px-2 py-1 text-[10px] font-bold text-slate-300">
                              <ReceiptText className="h-3 w-3" />
                              {tx.category}
                            </span>

                            {tx.excludeFromReports && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-[10px] font-bold text-purple-300">
                                Histórico / No reportable
                              </span>
                            )}
                            {tx.transferId && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-bold text-blue-300">
                                <ArrowRightLeft className="h-3 w-3" />
                                Transferencia
                              </span>
                            )}

                            {tx.batchImportId && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-300">
                                Importación
                              </span>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-slate-500">
                Selecciona una cuenta para ver sus movimientos
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
