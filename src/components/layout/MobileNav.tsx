import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { VisualModeToggle } from '../ui/VisualModeToggle';
import {
  LayoutDashboard,
  MessageSquare,
  ArrowLeftRight,
  FileSpreadsheet,
  HandCoins,
  BarChart3,
  ShieldCheck,
  Settings,
  MoreHorizontal,
  X,
} from 'lucide-react';

const primaryItems = [
  { to: '/dashboard', label: 'Inicio', icon: LayoutDashboard },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/transactions', label: 'Mov.', icon: ArrowLeftRight },
  { to: '/debts', label: 'Deudas', icon: HandCoins },
];

const moreItems = [
  { to: '/import', label: 'Importar', icon: FileSpreadsheet },
  { to: '/reports', label: 'Reportes', icon: BarChart3 },
  { to: '/backup', label: 'Respaldo', icon: ShieldCheck },
  { to: '/settings', label: 'Config.', icon: Settings },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const isMoreActive = moreItems.some((item) => location.pathname.startsWith(item.to));

  return (
    <>
      {open && (
        <div className="fixed inset-x-3 bottom-[5.25rem] z-50 rounded-[1.5rem] border border-slate-700/50 bg-slate-950/92 p-3 shadow-2xl shadow-black/40 backdrop-blur-2xl md:hidden">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">Más opciones</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-slate-700/50 p-2 text-slate-400 hover:text-slate-100"
              aria-label="Cerrar menú"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <VisualModeToggle compact className="mb-3" />
          <div className="grid grid-cols-2 gap-2">
            {moreItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm font-bold transition-all duration-200',
                    isActive
                      ? 'border-blue-400/30 bg-blue-500/15 text-blue-100'
                      : 'border-slate-700/40 bg-slate-900/45 text-slate-400 hover:text-slate-100'
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-700/50 bg-slate-950/88 px-2 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-2xl md:hidden">
        <div className="grid grid-cols-5 gap-1 py-2">
          {primaryItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                clsx(
                  'flex h-14 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-bold transition-all duration-200',
                  isActive ? 'border border-blue-400/25 bg-blue-500/15 text-blue-200 shadow-lg shadow-blue-500/10' : 'text-slate-500'
                )
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className={clsx(
              'flex h-14 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-bold transition-all duration-200',
              isMoreActive || open ? 'border border-blue-400/25 bg-blue-500/15 text-blue-200 shadow-lg shadow-blue-500/10' : 'text-slate-500'
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            Más
          </button>
        </div>
      </nav>
    </>
  );
}
