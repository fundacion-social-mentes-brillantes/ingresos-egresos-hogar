import { useNavigate } from 'react-router-dom';
import { Clock, LogOut, ShieldX } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { SUPER_ADMIN_EMAILS, type AccessStatus } from '../../lib/accessControl';

// Pantalla que ve quien AUN no esta aprobado. No es una barrera de seguridad
// (los datos ya estan aislados por cuenta): es el porton de producto. Como el
// acceso se escucha en vivo, cuando el admin aprueba, esta pantalla desaparece
// sola y entra a la app sin recargar.
export function AccessGate({ status, email }: { status: AccessStatus | undefined; email: string | null }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const denied = status === 'denied';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="auth-shell flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-700/40 bg-slate-900/60 p-8 text-center backdrop-blur-xl">
        <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl ${denied ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>
          {denied ? <ShieldX className="h-8 w-8" /> : <Clock className="h-8 w-8" />}
        </div>

        {denied ? (
          <>
            <h1 className="text-xl font-black text-slate-100">Acceso denegado</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              El administrador no autorizó el ingreso de esta cuenta. Si crees que es un error,
              escríbele al administrador del programa.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-black text-slate-100">Esperando aprobación</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Tu solicitud quedó registrada. El administrador debe autorizar tu ingreso.
              En cuanto te aprueben, esta pantalla se abrirá sola (no tienes que recargar).
            </p>
          </>
        )}

        <div className="mt-5 rounded-2xl border border-slate-700/40 bg-slate-950/40 p-3 text-xs text-slate-400">
          <p>Tu cuenta: <span className="font-bold text-slate-200">{email || 'desconocida'}</span></p>
          <p className="mt-1">Administrador: <span className="font-bold text-slate-200">{SUPER_ADMIN_EMAILS[0]}</span></p>
        </div>

        <button
          onClick={handleLogout}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-600/40 bg-slate-800/50 px-4 py-2.5 text-sm font-bold text-slate-200 transition hover:bg-slate-700/60"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
