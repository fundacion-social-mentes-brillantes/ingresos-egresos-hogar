import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTransactions } from '../hooks/useTransactions';
import { useDebts } from '../hooks/useDebts';
import { exportFinanceWorkbook } from '../lib/reporting';
import { getActionLogs, getDeletedTransactions, restoreDeletedTransaction, restoreLastDeletedTransaction } from '../lib/firestore';
import { EmptyState } from '../components/visual/EmptyState';
import { Download, History, RotateCcw, ShieldCheck, LockKeyhole, DatabaseBackup } from 'lucide-react';
import { ActionLog, DeletedTransaction, formatCOP } from '../types';

export function BackupPage() {
  const { user } = useAuth();
  const { transactions, accounts, refresh } = useTransactions();
  const { debts } = useDebts();
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletedTransactions, setDeletedTransactions] = useState<DeletedTransaction[]>([]);
  const [actionLogs, setActionLogs] = useState<ActionLog[]>([]);

  const loadHistory = async () => {
    if (!user) return;
    const [deleted, logs] = await Promise.allSettled([
      getDeletedTransactions(user.uid, 200),
      getActionLogs(user.uid, 200),
    ]);
    setDeletedTransactions(deleted.status === 'fulfilled' ? deleted.value : []);
    setActionLogs(logs.status === 'fulfilled' ? logs.value : []);
    if (deleted.status === 'rejected' || logs.status === 'rejected') {
      console.warn('Backup history partially unavailable:', { deleted, logs });
    }
  };

  useEffect(() => {
    loadHistory().catch((error) => console.error('Could not load backup history:', error));
  }, [user]);

  const exportBackup = async () => {
    setExporting(true);
    setMessage('');
    try {
      await exportFinanceWorkbook({
        transactions,
        debts,
        accounts,
        deletedTransactions,
        actionLogs,
        fileName: `respaldo-completo-finanzas-${new Date().toISOString().slice(0, 10)}.xlsx`,
      });
      setMessage(`Backup completo generado: ${transactions.length} movimientos, ${accounts.length} cuentas, ${debts.length} deudas, ${deletedTransactions.length} eliminados y ${actionLogs.length} acciones.`);
    } catch (error: any) {
      setMessage(error?.message || 'No pude generar el backup completo.');
    } finally {
      setExporting(false);
    }
  };

  const restoreById = async (deletedId: string) => {
    if (!user) return;
    setLoading(true);
    setMessage('');
    try {
      const restored = await restoreDeletedTransaction(user.uid, deletedId);
      if (restored) {
        setMessage(`Restaure ${restored.type === 'income' ? 'el ingreso' : 'el gasto'} de ${formatCOP(restored.amount)}: ${restored.description}.`);
        await refresh();
        await loadHistory();
      } else {
        setMessage('Ese movimiento ya no esta disponible para restaurar.');
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
        setMessage(`Restaure ${restored.type === 'income' ? 'el ingreso' : 'el gasto'} de ${formatCOP(restored.amount)}: ${restored.description}.`);
        await refresh();
        await loadHistory();
      } else {
        setMessage('No encontre movimientos borrados para restaurar.');
      }
    } catch (error: any) {
      setMessage(error?.message || 'No pude restaurar el ultimo movimiento.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <section className="lux-hero relative p-5 sm:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="lux-kicker">Seguridad de datos</p>
            <h1 className="lux-heading mt-2 text-3xl sm:text-4xl">Backup, historial y deshacer</h1>
            <p className="lux-subtle mt-2 max-w-2xl text-sm">Exporta datos, recupera movimientos borrados y revisa acciones importantes del asistente.</p>
          </div>
          <div className="premium-icon h-16 w-16 text-green-200">
            <LockKeyhole className="h-8 w-8" />
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="lux-card p-6">
          <div className="flex items-start gap-4">
            <div className="premium-icon h-14 w-14 text-green-200">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-100">Respaldo completo profesional</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">Incluye portada, resumen ejecutivo, auditoria de cuentas, libro mayor por cuenta, movimientos, deudas, categorias, mes a mes, eliminados, historial y guia de restauracion.</p>
            </div>
          </div>
          <button onClick={exportBackup} disabled={exporting} className="premium-button mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black transition disabled:opacity-50">
            <Download className="h-4 w-4" />
            {exporting ? 'Generando backup...' : 'Descargar backup Excel completo'}
          </button>
        </section>

        <section className="lux-card p-6">
          <div className="flex items-start gap-4">
            <div className="premium-icon h-14 w-14 text-amber-200">
              <RotateCcw className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-100">Restauracion rapida</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">Recupera el ultimo movimiento eliminado o elige uno especifico en el historial.</p>
            </div>
          </div>
          <button onClick={undoDelete} disabled={loading} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-400/25 bg-amber-500/20 px-4 py-3 text-sm font-black text-amber-100 transition hover:bg-amber-500/25 disabled:opacity-50">
            <RotateCcw className="h-4 w-4" />
            {loading ? 'Restaurando...' : 'Restaurar ultimo borrado'}
          </button>
        </section>
      </div>

      {message && <div className="rounded-3xl border border-blue-500/25 bg-blue-500/10 p-4 text-sm font-bold text-blue-100">{message}</div>}

      <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="lux-card p-5">
          <h2 className="mb-5 flex items-center gap-2 text-lg font-black text-slate-100">
            <DatabaseBackup className="h-5 w-5 text-amber-300" />
            Movimientos recuperables
          </h2>
          {deletedTransactions.length ? (
            <div className="space-y-3">
              {deletedTransactions.map((tx) => (
                <article key={tx.deletedId} className="rounded-3xl border border-slate-700/50 bg-slate-900/40 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-black text-slate-100">{tx.type === 'income' ? 'Ingreso' : 'Gasto'} de {formatCOP(tx.amount)}</p>
                      <p className="mt-1 text-xs text-slate-400">{tx.description} · {tx.category} · {tx.accountName}</p>
                      <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Borrado: {tx.deletedAt.toLocaleString('es-CO')}</p>
                    </div>
                    <button onClick={() => restoreById(tx.deletedId)} disabled={loading} className="rounded-2xl border border-amber-400/25 bg-amber-500/20 px-4 py-2.5 text-xs font-black text-amber-100 transition hover:bg-amber-500/25 disabled:opacity-50">
                      Restaurar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState asset="backups" title="No hay movimientos borrados" description="Cuando elimines un movimiento, podras recuperarlo desde este centro de seguridad." />
          )}
        </section>

        <section className="lux-card p-5">
          <h2 className="mb-5 flex items-center gap-2 text-lg font-black text-slate-100">
            <History className="h-5 w-5 text-blue-300" />
            Historial de acciones
          </h2>
          {actionLogs.length ? (
            <div className="space-y-3">
              {actionLogs.map((log) => (
                <article key={log.id} className="rounded-3xl border border-slate-700/50 bg-slate-900/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-100">{log.description}</p>
                      <p className="mt-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{log.action} · {log.status} · {log.source}</p>
                    </div>
                    <span className="whitespace-nowrap text-[11px] font-bold text-slate-500">{log.createdAt.toLocaleDateString('es-CO')}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState asset="backups" title="Aun no hay acciones registradas" description="Las acciones importantes del sistema apareceran aqui con fecha y estado." />
          )}
        </section>
      </div>
    </div>
  );
}
