import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTransactions } from '../hooks/useTransactions';
import { useDebts } from '../hooks/useDebts';
import { exportFinanceWorkbook } from '../lib/reporting';
import { getActionLogs, getDeletedTransactions, restoreDeletedTransaction, restoreLastDeletedTransaction } from '../lib/firestore';
import { Download, History, RotateCcw, ShieldCheck } from 'lucide-react';
import { ActionLog, DeletedTransaction, formatCOP } from '../types';

export function BackupPage() {
  const { user } = useAuth();
  const { transactions, accounts, refresh } = useTransactions();
  const { debts } = useDebts();
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletedTransactions, setDeletedTransactions] = useState<DeletedTransaction[]>([]);
  const [actionLogs, setActionLogs] = useState<ActionLog[]>([]);

  const loadHistory = async () => {
    if (!user) return;
    const [deleted, logs] = await Promise.all([
      getDeletedTransactions(user.uid, 12),
      getActionLogs(user.uid, 20),
    ]);
    setDeletedTransactions(deleted);
    setActionLogs(logs);
  };

  useEffect(() => {
    loadHistory().catch((error) => console.error('Could not load backup history:', error));
  }, [user]);

  const exportBackup = () => exportFinanceWorkbook({ transactions, debts, accounts, fileName: `respaldo-completo-finanzas-${new Date().toISOString().slice(0, 10)}.xlsx` });

  const restoreById = async (deletedId: string) => {
    if (!user) return;
    setLoading(true);
    setMessage('');
    try {
      const restored = await restoreDeletedTransaction(user.uid, deletedId);
      if (restored) {
        setMessage(`Restauré ${restored.type === 'income' ? 'el ingreso' : 'el gasto'} de ${formatCOP(restored.amount)}: ${restored.description}.`);
        await refresh();
        await loadHistory();
      } else {
        setMessage('Ese movimiento ya no está disponible para restaurar.');
      }
    } catch (error: any) {
      setMessage(error?.message || 'No pude restaurar el movimiento.');
    } finally {
      setLoading(false);
    }
  };

  const undoDelete = async () => {
    if (!user) return;
    setLoading(true);
    setMessage('');
    try {
      const restored = await restoreLastDeletedTransaction(user.uid);
      if (restored) {
        setMessage(`Restauré ${restored.type === 'income' ? 'el ingreso' : 'el gasto'} de ${formatCOP(restored.amount)}: ${restored.description}.`);
        await refresh();
        await loadHistory();
      } else {
        setMessage('No encontré movimientos borrados para restaurar.');
      }
    } catch (error: any) {
      setMessage(error?.message || 'No pude restaurar el último movimiento.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-10">
      <div className="glass rounded-3xl border border-slate-700/40 p-6">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-400">Seguridad de datos</p>
        <h1 className="mt-2 text-2xl font-black text-slate-100 sm:text-3xl">Backup, historial y deshacer</h1>
        <p className="mt-2 text-sm text-slate-400">Exporta tus datos, recupera movimientos borrados y revisa las acciones importantes del asistente.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="glass rounded-3xl border border-slate-700/40 p-6">
          <ShieldCheck className="mb-4 h-8 w-8 text-green-400" />
          <h2 className="text-lg font-bold text-slate-100">Respaldo completo</h2>
          <p className="mt-2 text-sm text-slate-400">Incluye resumen, movimientos, deudas, cuentas, alertas y oportunidades en un Excel organizado.</p>
          <button onClick={exportBackup} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-500">
            <Download className="h-4 w-4" /> Descargar backup Excel
          </button>
        </div>

        <div className="glass rounded-3xl border border-slate-700/40 p-6">
          <RotateCcw className="mb-4 h-8 w-8 text-amber-400" />
          <h2 className="text-lg font-bold text-slate-100">Restauración rápida</h2>
          <p className="mt-2 text-sm text-slate-400">Recupera el último movimiento eliminado o elige uno específico en el historial.</p>
          <button onClick={undoDelete} disabled={loading} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-600 px-4 py-3 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-50">
            <RotateCcw className="h-4 w-4" /> {loading ? 'Restaurando...' : 'Restaurar último borrado'}
          </button>
        </div>
      </div>

      {message && <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-100">{message}</div>}

      <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="glass rounded-3xl border border-slate-700/40 p-5">
          <h2 className="mb-4 flex items-center gap-2 font-bold text-slate-100"><RotateCcw className="h-5 w-5 text-amber-400" /> Movimientos borrados recuperables</h2>
          {deletedTransactions.length ? (
            <div className="space-y-3">
              {deletedTransactions.map((tx) => (
                <div key={tx.deletedId} className="rounded-2xl border border-slate-700/60 bg-slate-900/50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-100">{tx.type === 'income' ? 'Ingreso' : 'Gasto'} de {formatCOP(tx.amount)}</p>
                      <p className="text-xs text-slate-400">{tx.description} · {tx.category} · {tx.accountName}</p>
                      <p className="mt-1 text-[11px] text-slate-500">Borrado: {tx.deletedAt.toLocaleString('es-CO')}</p>
                    </div>
                    <button onClick={() => restoreById(tx.deletedId)} disabled={loading} className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-50">Restaurar</button>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">No hay movimientos borrados pendientes por recuperar.</p>}
        </div>

        <div className="glass rounded-3xl border border-slate-700/40 p-5">
          <h2 className="mb-4 flex items-center gap-2 font-bold text-slate-100"><History className="h-5 w-5 text-blue-400" /> Historial de acciones</h2>
          {actionLogs.length ? (
            <div className="space-y-3">
              {actionLogs.map((log) => (
                <div key={log.id} className="rounded-2xl border border-slate-700/60 bg-slate-900/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{log.description}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">{log.action} · {log.status} · {log.source}</p>
                    </div>
                    <span className="whitespace-nowrap text-[11px] text-slate-500">{log.createdAt.toLocaleDateString('es-CO')}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">Aún no hay acciones registradas.</p>}
        </div>
      </div>
    </div>
  );
}
