import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Crown, Loader2, Users, UserCheck, UserX } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { decideAccess, isSuperAdminEmail, listAccess, listRegisteredUsers, setAccessRole, type AccessRole } from '../lib/accessControl';

// 'none' = registrado en el programa pero aun sin solicitud de acceso (no ha
// abierto la version nueva). El admin puede pre-aprobarlo o denegarlo igual.
type RowStatus = 'pending' | 'approved' | 'denied' | 'none';

interface Row {
  uid: string;
  email: string;
  displayName: string;
  status: RowStatus;
  role: AccessRole;
  isSuper: boolean;
  suspicious: boolean;
  createdAt?: Date;
}

const STATUS_LABEL: Record<RowStatus, string> = { pending: 'Pendiente', approved: 'Aprobado', denied: 'Denegado', none: 'Sin ingresar aún' };
const STATUS_TONE: Record<RowStatus, string> = {
  pending: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  approved: 'border-green-400/30 bg-green-400/10 text-green-200',
  denied: 'border-red-400/30 bg-red-400/10 text-red-200',
  none: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
};
const STATUS_ORDER: Record<RowStatus, number> = { pending: 0, none: 1, approved: 2, denied: 3 };

export function AdminPage() {
  const { user, isSuperAdmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Perfiles registrados + solicitudes de acceso.
      // SEGURIDAD: la corona de super-admin se decide SOLO por la sesion
      // autenticada (token verificado por Firebase), nunca por el campo email
      // de un documento (ese campo lo escribe el propio usuario y podria
      // suplantarse). Un email de perfil igual al del super-admin en OTRA fila
      // se marca como sospechoso y conserva los controles de moderacion.
      const [registered, access] = await Promise.all([listRegisteredUsers(), listAccess()]);
      const accessMap = new Map(access.map((a) => [a.uid, a]));
      const markRow = (uid: string, email: string): { isSuper: boolean; suspicious: boolean } => {
        const isSuper = isSuperAdmin && uid === user?.uid;
        const suspicious = !isSuper && isSuperAdmin && isSuperAdminEmail(email);
        return { isSuper, suspicious };
      };
      const merged: Row[] = registered.map((u) => {
        const a = accessMap.get(u.uid);
        const mark = markRow(u.uid, u.email);
        return {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName || '',
          createdAt: u.createdAt,
          isSuper: mark.isSuper,
          suspicious: mark.suspicious,
          status: mark.isSuper ? 'approved' : ((a?.status as RowStatus) ?? 'none'),
          role: mark.isSuper ? 'admin' : (a?.role ?? 'user'),
        };
      });
      // Solicitudes cuyo perfil no aparece (caso raro): tambien se muestran.
      access.forEach((a) => {
        if (!merged.some((r) => r.uid === a.uid)) {
          const mark = markRow(a.uid, a.email);
          merged.push({ uid: a.uid, email: a.email, displayName: a.displayName || '', status: a.status, role: a.role, isSuper: mark.isSuper, suspicious: mark.suspicious });
        }
      });
      merged.sort((a, b) => {
        if (a.isSuper !== b.isSuper) return a.isSuper ? -1 : 1;
        if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        return (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0);
      });
      setRows(merged);
      setError('');
    } catch (err: any) {
      setError(err?.message || 'No pude cargar la lista de personas.');
    } finally {
      setLoading(false);
    }
  }, [user?.uid, isSuperAdmin]);

  useEffect(() => { load(); }, [load]);

  const act = async (uid: string, fn: () => Promise<void>) => {
    setBusy(uid);
    setError('');
    try { await fn(); await load(); }
    catch (err: any) { setError(err?.message || 'No pude aplicar el cambio.'); }
    finally { setBusy(null); }
  };

  const counts = useMemo(() => ({
    total: rows.length,
    approved: rows.filter((r) => r.status === 'approved').length,
    pending: rows.filter((r) => r.status === 'pending').length,
    denied: rows.filter((r) => r.status === 'denied').length,
    none: rows.filter((r) => r.status === 'none').length,
  }), [rows]);

  const deciderEmail = user?.email || '';

  const changeRole = (r: Row, role: AccessRole) => act(r.uid, async () => {
    await setAccessRole(r.uid, role, deciderEmail, { email: r.email, displayName: r.displayName });
    // Nombrar admin implica poder entrar: si no estaba aprobado, se aprueba.
    if (role === 'admin' && r.status !== 'approved') await decideAccess(r.uid, 'approved', deciderEmail, { email: r.email, displayName: r.displayName });
  });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 pb-10">
      <section className="lux-hero p-5 sm:p-7">
        <p className="lux-kicker">Control de acceso</p>
        <h1 className="lux-heading mt-2 text-3xl sm:text-4xl">Administración</h1>
        <p className="lux-subtle mt-2 max-w-2xl text-sm">Aquí aparecen todas las personas registradas en el programa. Apruebas o deniegas su ingreso y eliges su rol.</p>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-black">
          <span className="rounded-full border border-slate-600/40 bg-slate-800/50 px-3 py-1 text-slate-200">Registrados: {counts.total}</span>
          <span className="rounded-full border border-green-400/30 bg-green-400/10 px-3 py-1 text-green-200">Aprobados: {counts.approved}</span>
          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-200">Pendientes: {counts.pending}</span>
          <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-3 py-1 text-slate-300">Sin ingresar aún: {counts.none}</span>
          <span className="rounded-full border border-red-400/30 bg-red-400/10 px-3 py-1 text-red-200">Denegados: {counts.denied}</span>
        </div>
      </section>

      {error && <div className="flex items-center gap-2 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}

      <section className="lux-card p-4">
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-blue-300" />
          <h2 className="text-sm font-black text-slate-100">Personas ({rows.length})</h2>
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-blue-400" /></div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Aún no hay personas registradas.</p>
        ) : (
          <div className="grid gap-3">
            {rows.map((r) => {
              const working = busy === r.uid;
              return (
                <article key={r.uid} className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-black text-slate-100">{r.email || r.uid}</p>
                        {r.uid === user?.uid && <span className="rounded-full border border-blue-400/30 bg-blue-400/10 px-2 py-0.5 text-[10px] font-black text-blue-200">Tú</span>}
                        {r.isSuper ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-yellow-400/30 bg-yellow-400/10 px-2 py-0.5 text-[10px] font-black text-yellow-200"><Crown className="h-3 w-3" />Super admin</span>
                        ) : (
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                        )}
                        {r.suspicious && <span className="inline-flex items-center gap-1 rounded-full border border-red-400/40 bg-red-500/15 px-2 py-0.5 text-[10px] font-black text-red-200"><AlertCircle className="h-3 w-3" />Correo suplantado: NO es el super admin</span>}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {r.displayName || 'Sin nombre'}
                        {r.createdAt ? <> · registrado el {r.createdAt.toLocaleDateString('es-CO')}</> : null}
                      </p>
                    </div>

                    {/* Los controles solo se ocultan para TU propia fila (no
                        puedes moderarte a ti mismo); nunca por el email que
                        diga un documento. */}
                    {r.uid !== user?.uid && (
                      <div className="flex flex-wrap items-center gap-2">
                        {r.status !== 'approved' && (
                          <button disabled={working} onClick={() => act(r.uid, () => decideAccess(r.uid, 'approved', deciderEmail, { email: r.email, displayName: r.displayName }))} className="inline-flex items-center gap-1.5 rounded-xl border border-green-400/30 bg-green-500/15 px-3 py-1.5 text-xs font-black text-green-200 transition hover:bg-green-500/25 disabled:opacity-40"><UserCheck className="h-3.5 w-3.5" />Aprobar</button>
                        )}
                        {r.status !== 'denied' && (
                          <button disabled={working} onClick={() => act(r.uid, () => decideAccess(r.uid, 'denied', deciderEmail, { email: r.email, displayName: r.displayName }))} className="inline-flex items-center gap-1.5 rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-1.5 text-xs font-black text-red-200 transition hover:bg-red-500/25 disabled:opacity-40"><UserX className="h-3.5 w-3.5" />Denegar</button>
                        )}
                        <label className="flex items-center gap-1.5 text-[11px] font-black text-slate-400">
                          Rol
                          <select
                            value={r.role}
                            disabled={working}
                            onChange={(e) => changeRole(r, e.target.value as AccessRole)}
                            className="lux-input rounded-xl border border-slate-600/40 bg-slate-900/70 px-2 py-1.5 text-xs font-black text-slate-100 outline-none disabled:opacity-40"
                          >
                            <option value="user">Usuario</option>
                            <option value="admin">Admin</option>
                          </select>
                        </label>
                        {working && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-500"><Check className="h-3.5 w-3.5 shrink-0" />El admin solo puede ver el perfil de cada persona (nombre, correo, foto y estado). Las finanzas son privadas: nadie, ni el admin, puede ver las cuentas, movimientos o deudas de otro.</p>
    </div>
  );
}

export default AdminPage;
