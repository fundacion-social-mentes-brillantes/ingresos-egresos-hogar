import { useMemo, useState } from 'react';
import { Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle, Database, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { addAccount, addTransaction, getAccounts } from '../lib/firestore';
import { DEFAULT_ACCOUNTS, formatCOP } from '../types';
import type { Account } from '../types';
import { parseExcelFile, type ImportedTransactionDraft, type ImportPreviewResult } from '../lib/importExcel';

function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function ensureAccounts(uid: string): Promise<Account[]> {
  const existing = await getAccounts(uid);
  if (existing.length > 0) return existing;

  await Promise.all(
    DEFAULT_ACCOUNTS.map((account) =>
      addAccount(uid, {
        ...account,
        initialBalance: 0,
        currentBalance: 0,
        active: true,
      })
    )
  );

  return getAccounts(uid);
}

function totals(drafts: ImportedTransactionDraft[]) {
  return drafts.reduce(
    (acc, tx) => {
      if (tx.type === 'income') acc.income += tx.amount;
      if (tx.type === 'expense') acc.expense += tx.amount;
      return acc;
    },
    { income: 0, expense: 0 }
  );
}

export function ImportPage() {
  const { user } = useAuth();
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewTotals = useMemo(() => totals(preview?.drafts || []), [preview]);

  const handleFile = async (file?: File) => {
    if (!file || !user) return;

    setLoading(true);
    setError(null);
    setDone(null);
    setPreview(null);
    setFileName(file.name);

    try {
      const allowed = /\.(xlsx|xls|csv)$/i.test(file.name);
      if (!allowed) throw new Error('Sube un archivo Excel .xlsx, .xls o .csv.');

      const accounts = await ensureAccounts(user.uid);
      const result = await parseExcelFile(file, accounts);
      if (result.drafts.length === 0) {
        throw new Error('Leí el archivo, pero no encontré movimientos claros. Revisa que tenga columnas como fecha, concepto, ingreso, gasto o valor.');
      }
      setPreview(result);
    } catch (err: any) {
      setError(err?.message || 'No pude leer el archivo.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user || !preview?.drafts.length) return;

    setSaving(true);
    setError(null);
    setDone(null);

    try {
      for (const draft of preview.drafts) {
        await addTransaction(user.uid, draft);
      }
      setDone({ count: preview.drafts.length });
    } catch (err: any) {
      setError(err?.message || 'No pude guardar los movimientos.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 pb-8">
      <div className="glass rounded-3xl border border-slate-700/40 p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-400">Migración financiera</p>
            <h1 className="mt-2 text-2xl font-black text-slate-100 sm:text-3xl">Importar Excel de ingresos y gastos</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
              Sube tu archivo antiguo de Excel o CSV. Primero lo organizo en una vista previa; después tú confirmas si quieres guardarlo en el sistema.
            </p>
          </div>
          <div className="hidden rounded-3xl bg-blue-500/10 p-4 text-blue-300 sm:block">
            <FileSpreadsheet className="h-10 w-10" />
          </div>
        </div>
      </div>

      <label className="group flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-blue-500/40 bg-slate-900/70 p-8 text-center transition hover:border-blue-400 hover:bg-blue-500/5">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
        <div className="mb-4 rounded-3xl bg-blue-500/10 p-5 text-blue-300 transition group-hover:scale-105">
          {loading ? <Loader2 className="h-9 w-9 animate-spin" /> : <Upload className="h-9 w-9" />}
        </div>
        <h2 className="text-lg font-bold text-slate-100">Toca para subir Excel o CSV</h2>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          Funciona mejor si el archivo tiene columnas como Fecha, Concepto, Ingreso, Gasto, Valor, Categoría o Cuenta.
        </p>
        {fileName && <p className="mt-3 rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">{fileName}</p>}
      </label>

      {error && (
        <div className="flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
          <p>{error}</p>
        </div>
      )}

      {done && (
        <div className="flex gap-3 rounded-2xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-100">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-300" />
          <p>Listo. Guardé {done.count} movimientos. El dashboard y Movimientos deben actualizarse automáticamente.</p>
        </div>
      )}

      {preview && (
        <div className="glass overflow-hidden rounded-3xl border border-slate-700/40">
          <div className="border-b border-slate-700/40 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-100">Vista previa antes de guardar</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Leí {preview.rowsRead} filas y preparé {preview.drafts.length} movimientos.
                </p>
              </div>
              <button
                onClick={handleSave}
                disabled={saving || preview.drafts.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                Guardar movimientos
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-4">
                <p className="text-xs font-bold uppercase text-green-400">Ingresos detectados</p>
                <p className="mt-1 text-lg font-black text-slate-100">{formatCOP(previewTotals.income)}</p>
              </div>
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-xs font-bold uppercase text-red-400">Gastos detectados</p>
                <p className="mt-1 text-lg font-black text-slate-100">{formatCOP(previewTotals.expense)}</p>
              </div>
              <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4">
                <p className="text-xs font-bold uppercase text-blue-400">Balance importado</p>
                <p className="mt-1 text-lg font-black text-slate-100">{formatCOP(previewTotals.income - previewTotals.expense)}</p>
              </div>
            </div>
          </div>

          <div className="max-h-[420px] overflow-auto custom-scrollbar">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="sticky top-0 bg-slate-900 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Descripción</th>
                  <th className="px-4 py-3">Categoría</th>
                  <th className="px-4 py-3">Cuenta</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {preview.drafts.slice(0, 100).map((tx, index) => (
                  <tr key={`${tx.description}-${index}`} className="hover:bg-slate-800/40">
                    <td className="px-4 py-3 text-slate-400">{tx.date.toLocaleDateString('es-CO')}</td>
                    <td className={`px-4 py-3 font-bold ${tx.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                      {tx.type === 'income' ? 'Ingreso' : 'Gasto'}
                    </td>
                    <td className="px-4 py-3 text-slate-100">{tx.description}</td>
                    <td className="px-4 py-3 text-slate-300">{tx.category}</td>
                    <td className="px-4 py-3 text-slate-300">{tx.accountName}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-100">{formatCOP(tx.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.skipped.length > 0 && (
            <div className="border-t border-slate-700/40 p-4 text-xs text-amber-200/80">
              <p className="mb-2 font-bold text-amber-300">Filas que no guardaría automáticamente:</p>
              <ul className="list-inside list-disc space-y-1">
                {preview.skipped.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
