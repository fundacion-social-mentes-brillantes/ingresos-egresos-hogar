import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
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
} from 'lucide-react';
import clsx from 'clsx';

const navItems = [
  { to: '/dashboard',     label: 'Inicio',        icon: LayoutDashboard  },
  { to: '/chat',          label: 'Chat',           icon: MessageSquare    },
  { to: '/transactions',  label: 'Movimientos',    icon: ArrowLeftRight   },
  { to: '/debts',         label: 'Deudas',         icon: HandCoins        },
  { to: '/import',        label: 'Importar',       icon: FileSpreadsheet  },
  { to: '/reports',       label: 'Reportes',       icon: BarChart3        },
  { to: '/backup',        label: 'Respaldo',       icon: ShieldCheck      },
  { to: '/settings',      label: 'Config.',        icon: Settings         },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 glass border-r border-slate-700/40 flex flex-col z-40 hidden md:flex">
      <div className="p-6 border-b border-slate-700/40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-slate-100 text-sm leading-tight">Ingresos &</p>
            <p className="font-bold text-slate-100 text-sm leading-tight">Egresos Hogar</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto custom-scrollbar">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700/50'
              )
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-700/40">
        <div className="flex items-center gap-3 px-2 mb-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-sm font-bold text-white">
            {user?.displayName?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">{user?.displayName ?? 'Usuario'}</p>
            <p className="text-xs text-slate-500 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}

export function BottomNav() {
  const mobileItems = navItems.slice(0, 5);
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-slate-950/90 backdrop-blur-xl border-t border-slate-700/50 flex md:hidden z-50 pb-[env(safe-area-inset-bottom)] shadow-2xl">
      {mobileItems.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            clsx(
              'flex-1 flex h-16 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-all duration-200',
              isActive ? 'text-blue-400' : 'text-slate-500'
            )
          }
        >
          <Icon className="w-5 h-5" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
