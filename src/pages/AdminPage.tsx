import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Loader2, ShieldCheck, ShieldOff, UserCheck, UserX, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { decideAccess, listAccess, setAccessRole, type AccessRecord } from '../lib/accessControl';

const STATUS_LABEL: Record<string, string> = { pending: 'Pendiente', approved: 'Aprobado', denied: 'Denegado' };
const STATUS_TONE: Record<string, string> = {
  pending: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  approved: 'border-green-400/30 bg-green-400/10 text-green-200',
  denied: 'border-red-400/30 bg-red-400/10 text-red-200',
};

export function AdminPage() {
  const { user } = useAuth();
  const [records, setRecords] = useState<AccessRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listAccess();
      list.sort((a, b) => {
        const order: Record<string, number> = { pending: 0, approved: 1, denied: 2 };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return (b.requestedAt?.getTime?.() || 0) - (a.requestedAt?.getTime?.() || 0);
      });
      setRecords(list);
      setError('');
    } catch (err: any) {
      setError(err?.message || 'No pude cargar la lista de accesos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (uid: string, fn: () => Promise<void>) => {
    setBusy(uid);
    setError('');
    try { await fn(); await load(); }
    catch (err: any) { setError(err?.message || 'No pude aplicar el cambio.'); }
    finally { setBusy(null); }
  };

  const pending = useMemo(() => records.filter((r) => r.status === 'pending'), [records]);
  const deciderEmail = user?.email || '';

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 pb-10">
      <section className="lux-hero p-5 sm:p-7">
        <p className="lux-kicker">Control de acceso</p>
        <h1 className="lux-heading mt-2 text-3xl sm:text-4xl">Administración</h1>
        <p className="lux-subtle mt-2 max-w-2xl text-sm">
          Aprueba o deniega quién puede usar el programa y nombra otros administradores.
          {pending.length > 0 && <> Hay <span className="font-black text-amber-200">{pending.length}</span> solicitud(es) pendiente(s).</>}
        </p>
      </section>

      {error && <div className="flex items-center gap-2 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}

      <section className="lux-card p-4">
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-blue-300" />
          <h2 className="text-sm font-black text-slate-100">Personas ({records.length})</h2>
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-blue-400" /></div>
        ) : records.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Aún no hay solicitudes. Cuando alguien inicie sesión aparecerá aquí para aprobar o denegar.</p>
        ) : (
          <div className="grid gap-3">
            {records.map((r) => {
              const working = busy === r.uid;
              return (
                <article key={r.uid} className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-black text-slate-100">{r.email || r.uid}</p>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${STATUS_TONE[r.status] || ''}`}>{STATUS_LABEL[r.status] || r.status}</span>
                        {r.role === 'admin' && <span className="inline-flex items-center gap-1 rounded-full border border-blue-400/30 bg-blue-400/10 px-2 py-0.5 text-[10px] font-black text-blue-200"><ShieldCheck className="h-3 w-3" />Admin</span>}
                      </div>
                      {r.displayName && <p className="mt-0.5 truncate text-xs text-slate-500">{r.displayName}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {r.status !== 'approved' && (
                        <button disabled={working} onClick={() => act(r.uid, () => decideAccess(r.uid, 'approved', deciderEmail))} className="inline-flex items-center gap-1.5 rounded-xl border border-green-400/30 bg-green-500/15 px-3 py-1.5 text-xs font-black text-green-200 transition hover:bg-green-500/25 disabled:opacity-40"><UserCheck className="h-3.5 w-3.5" />Aprobar</button>
                      )}
                      {r.status !== 'denied' && (
                        <button disabled={working} onClick={() => act(r.uid, () => decideAccess(r.uid, 'denied', deciderEmail))} className="inline-flex items-center gap-1.5 rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-1.5 text-xs font-black text-red-200 transition hover:bg-red-500/25 disabled:opacity-40"><UserX className="h-3.5 w-3.5" />Denegar</button>
                      )}
                      {r.role === 'admin' ? (
                        <button disabled={working} onClick={() => act(r.uid, () => setAccessRole(r.uid, 'user', deciderEmail))} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-600/40 bg-slate-800/50 px-3 py-1.5 text-xs font-black text-slate-300 transition hover:bg-slate-700/60 disabled:opacity-40"><ShieldOff className="h-3.5 w-3.5" />Quitar admin</button>
                      ) : (
                        <button disabled={working} onClick={() => act(r.uid, async () => { await setAccessRole(r.uid, 'admin', deciderEmail); if (r.status !== 'approved') await decideAccess(r.uid, 'approved', deciderEmail); })} className="inline-flex items-center gap-1.5 rounded-xl border border-blue-400/30 bg-blue-500/15 px-3 py-1.5 text-xs font-black text-blue-200 transition hover:bg-blue-500/25 disabled:opacity-40"><ShieldCheck className="h-3.5 w-3.5" />Hacer admin</button>
                      )}
                      {working && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500"><Check className="h-3.5 w-3.5" />Cada persona aprobada usa su propio libro privado. Nadie ve los datos de otro.</p>
    </div>
  );
}

export default AdminPage;
