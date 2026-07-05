import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useUserProfile } from '../../hooks/useUserProfile';
import { ProfileAvatar } from '../visual/ProfileAvatar';
import { VisualModeToggle } from '../ui/VisualModeToggle';
import {
  LayoutDashboard,
  MessageSquare,
  ArrowLeftRight,
  Settings,
  LogOut,
  TrendingUp,
  FileSpreadsheet,
  HandCoins,
  BarChart3,
  ShieldCheck,
  Sparkles,
  WalletCards,
  Users,
} from 'lucide-react';
import clsx from 'clsx';

const navItems = [
  { to: '/dashboard',     label: 'Inicio',        icon: LayoutDashboard  },
  { to: '/chat',          label: 'Copiloto',       icon: MessageSquare    },
  { to: '/transactions',  label: 'Movimientos',    icon: ArrowLeftRight   },
  { to: '/debts',         label: 'Deudas',         icon: HandCoins        },
  { to: '/accounts',      label: 'Cuentas',        icon: WalletCards      },
  { to: '/import',        label: 'Importar',       icon: FileSpreadsheet  },
  { to: '/reports',       label: 'Reportes',       icon: BarChart3        },
  { to: '/backup',        label: 'Respaldo',       icon: ShieldCheck      },
  { to: '/settings',      label: 'Ajustes',        icon: Settings         },
];

export function Sidebar() {
  const { logout, isAdmin } = useAuth();
  const { displayName, email, photo, initials } = useUserProfile();
  const navigate = useNavigate();
  const items = isAdmin ? [...navItems, { to: '/admin', label: 'Admin', icon: Users }] : navItems;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <aside className="premium-panel fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col border-r border-slate-700/40 md:flex">
      <div className="p-5">
        <div className="lux-hero relative rounded-[1.35rem] p-4">
          <div className="flex items-center gap-3">
            <div className="premium-icon h-12 w-12 text-blue-200">
              <TrendingUp className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-300">Luxury cockpit</p>
              <p className="mt-1 text-sm font-black leading-tight text-slate-100">Ingresos &</p>
              <p className="text-sm font-black leading-tight text-slate-100">Egresos Hogar</p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-blue-400/20 bg-blue-400/10 px-3 py-2 text-[11px] font-bold text-blue-200">
            <Sparkles className="h-3.5 w-3.5" />
            Control familiar premium
          </div>
        </div>
        <VisualModeToggle className="mt-3" />
      </div>

      <nav className="custom-scrollbar flex-1 space-y-1 overflow-y-auto px-4 pb-4">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'group relative flex items-center gap-3 overflow-hidden rounded-2xl px-4 py-3 text-sm font-bold transition-all duration-200',
                isActive
                  ? 'border border-blue-400/30 bg-blue-500/15 text-blue-100 shadow-lg shadow-blue-500/10'
                  : 'text-slate-400 hover:bg-white/[0.055] hover:text-slate-100'
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={clsx('absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full transition-all', isActive ? 'bg-blue-400 opacity-100' : 'bg-transparent opacity-0')} />
                <span className={clsx('flex h-9 w-9 items-center justify-center rounded-xl border transition-all', isActive ? 'border-blue-400/30 bg-blue-400/15 text-blue-200' : 'border-slate-700/40 bg-slate-900/30 text-slate-500 group-hover:border-slate-500/40 group-hover:text-slate-200')}>
                  <Icon className="h-4 w-4" />
                </span>
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-700/40 p-4">
        <div className="mb-3 rounded-3xl border border-slate-700/40 bg-slate-900/40 p-3">
          <div className="flex items-center gap-3">
            <ProfileAvatar src={photo} initials={initials} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black text-slate-100">{displayName}</p>
              <p className="truncate text-xs text-slate-500">{email}</p>
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-bold text-red-300 transition-all duration-200 hover:border-red-400/40 hover:bg-red-500/15"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesion
        </button>
      </div>
    </aside>
  );
}
