import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Mail, Lock, User, TrendingUp, AlertCircle } from 'lucide-react';

export function LoginPage() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode]         = useState<'login' | 'register'>('login');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [form, setForm]         = useState({ name: '', email: '', password: '', confirm: '' });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

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
