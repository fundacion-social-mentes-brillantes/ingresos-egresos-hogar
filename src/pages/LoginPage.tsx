import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Mail, Lock, User, TrendingUp, AlertCircle } from 'lucide-react';

export function LoginPage() {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode]         = useState<'login' | 'register'>('login');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [form, setForm]         = useState({ name: '', email: '', password: '', confirm: '' });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogle();
      navigate('/dashboard');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/popup-closed-by-user') {
        setError('Cerraste la ventana de Google antes de terminar.');
      } else if (code === 'auth/popup-blocked') {
        setError('El navegador bloqueó la ventana de Google. Permite ventanas emergentes e intenta de nuevo.');
      } else {
        setError('No se pudo iniciar sesión con Google. Intenta de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'register') {
      if (!form.name.trim())              return setError('Escribe tu nombre.');
      if (form.password !== form.confirm) return setError('Las contraseñas no coinciden.');
      if (form.password.length < 6)      return setError('La contraseña debe tener al menos 6 caracteres.');
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await signIn(form.email, form.password);
      } else {
        await signUp(form.email, form.password, form.name);
      }
      navigate('/dashboard');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential')
        setError('Correo o contraseña incorrectos.');
      else if (code === 'auth/email-already-in-use')
        setError('Este correo ya está registrado.');
      else
        setError('Ocurrió un error. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: 'radial-gradient(ellipse at 20% 50%, rgba(37,99,235,0.15) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(99,102,241,0.1) 0%, transparent 50%), #0f172a' }}
    >
      {/* Logo */}
      <div className="mb-8 text-center animate-slide-up">
        <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-500/30 animate-pulse-glow">
          <TrendingUp className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold gradient-text">Ingresos & Egresos</h1>
        <p className="text-slate-400 text-sm mt-1">Control financiero familiar</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-md glass rounded-3xl p-8 animate-fade-in border border-slate-700/40">
        {/* Tabs */}
        <div className="flex bg-slate-800/50 rounded-xl p-1 mb-6">
          {(['login', 'register'] as const).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(''); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                mode === m
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m === 'login' ? 'Iniciar sesión' : 'Registrarse'}
            </button>
          ))}
        </div>

        {/* Google Sign In */}
        <div className="space-y-4 mb-6">
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border border-slate-700 hover:bg-slate-800 transition-all duration-200 group relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                style={{ fill: '#4285F4' }}
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-1 .67-2.28 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                style={{ fill: '#34A853' }}
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.67-.35-1.39-.35-2.09s.13-1.42.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                style={{ fill: '#FBBC05' }}
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                style={{ fill: '#EA4335' }}
              />
            </svg>
            <span className="text-slate-200 font-medium">Continuar con Google</span>
          </button>

          <div className="flex items-center gap-4 text-slate-500 py-2">
            <div className="h-px flex-1 bg-slate-800" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">O continúa con correo</span>
            <div className="h-px flex-1 bg-slate-800" />
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'register' && (
            <Input
              label="Nombre completo"
              type="text"
              placeholder="Tu nombre"
              value={form.name}
              onChange={set('name')}
              icon={<User className="w-4 h-4" />}
              required
            />
          )}
          <Input
            label="Correo electrónico"
            type="email"
            placeholder="correo@ejemplo.com"
            value={form.email}
            onChange={set('email')}
            icon={<Mail className="w-4 h-4" />}
            required
          />
          <Input
            label="Contraseña"
            type="password"
            placeholder="••••••••"
            value={form.password}
            onChange={set('password')}
            icon={<Lock className="w-4 h-4" />}
            required
          />
          {mode === 'register' && (
            <Input
              label="Confirmar contraseña"
              type="password"
              placeholder="••••••••"
              value={form.confirm}
              onChange={set('confirm')}
              icon={<Lock className="w-4 h-4" />}
              required
            />
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <Button type="submit" loading={loading} className="w-full mt-2" size="lg">
            {mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </Button>
        </form>

        <p className="text-center text-xs text-slate-500 mt-6">
          {mode === 'register' ? 'Al registrarte aceptas los términos de uso.' : 'Acceso solo para miembros del hogar.'}
        </p>
      </div>
    </div>
  );
}
