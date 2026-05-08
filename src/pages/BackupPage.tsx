import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTransactions } from '../hooks/useTransactions';
import { useDebts } from '../hooks/useDebts';
import { exportFinanceWorkbook } from '../lib/reporting';
import { restoreLastDeletedTransaction } from '../lib/firestore';
import { Download, RotateCcw, ShieldCheck } from 'lucide-react';
import { formatCOP } from '../types';

export function BackupPage() {
  const { user } = useAuth();
  const { transactions, accounts, refresh } = useTransactions();
  const { debts } = useDebts();
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const exportBackup = () => exportFinanceWorkbook({ transactions, debts, accounts, fileName: `respaldo-completo-finanzas-${new Date().toISOString().slice(0, 10)}.xlsx` });

  const undoDelete = async () => {
    if (!user) return;
    setLoading(true);
    setMessage('');
    try {
      const restored = await restoreLastDeletedTransaction(user.uid);
      if (restored) {
        setMessage(`Restauré ${restored.type === 'income' ? 'el ingreso' : 'el gasto'} de ${formatCOP(restored.amount)}: ${restored.description}.`);
        await refresh();
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
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <div className="glass rounded-3xl border border-slate-700/40 p-6">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-400">Seguridad de datos</p>
        <h1 className="mt-2 text-2xl font-black text-slate-100 sm:text-3xl">Backup y deshacer</h1>
        <p className="mt-2 text-sm text-slate-400">Exporta todos tus datos y recupera el último movimiento borrado por error.</p>
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
          <h2 className="text-lg font-bold text-slate-100">Deshacer borrado</h2>
          <p className="mt-2 text-sm text-slate-400">Si borraste un ingreso o gasto por error, puedes recuperar el último movimiento eliminado.</p>
          <button onClick={undoDelete} disabled={loading} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-600 px-4 py-3 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-50">
            <RotateCcw className="h-4 w-4" /> {loading ? 'Restaurando...' : 'Restaurar último borrado'}
          </button>
        </div>
      </div>

      {message && <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-100">{message}</div>}
    </div>
  );
}
