import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard,
  MessageSquare,
  ArrowLeftRight,
  FileSpreadsheet,
  HandCoins,
  BarChart3,
  ShieldCheck,
  Settings,
} from 'lucide-react';

const mobileItems = [
  { to: '/dashboard', label: 'Inicio', icon: LayoutDashboard },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/transactions', label: 'Mov.', icon: ArrowLeftRight },
  { to: '/debts', label: 'Deudas', icon: HandCoins },
  { to: '/import', label: 'Importar', icon: FileSpreadsheet },
  { to: '/reports', label: 'Reportes', icon: BarChart3 },
  { to: '/backup', label: 'Respaldo', icon: ShieldCheck },
  { to: '/settings', label: 'Config.', icon: Settings },
];

export function MobileNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 overflow-x-auto border-t border-slate-700/50 bg-slate-950/85 px-2 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-2xl md:hidden">
      <div className="flex min-w-max gap-1 py-2">
        {mobileItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex h-14 min-w-[4.65rem] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-bold transition-all duration-200',
                isActive ? 'border border-blue-400/25 bg-blue-500/15 text-blue-200 shadow-lg shadow-blue-500/10' : 'text-slate-500'
              )
            }
          >
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
