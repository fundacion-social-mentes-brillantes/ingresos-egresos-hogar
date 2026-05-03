import clsx from 'clsx';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  gradient?: boolean;
}

export function Card({ children, className, gradient }: CardProps) {
  return (
    <div
      className={clsx(
        'glass rounded-2xl p-5',
        gradient && 'bg-gradient-to-br from-blue-600/20 to-indigo-700/20',
        className
      )}
    >
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'red' | 'amber';
  sub?: string;
}

const colorMap = {
  blue:  { border: 'border-blue-500/30',  icon: 'bg-blue-500/10 text-blue-400',  text: 'text-blue-400'  },
  green: { border: 'border-green-500/30', icon: 'bg-green-500/10 text-green-400', text: 'text-green-400' },
  red:   { border: 'border-red-500/30',   icon: 'bg-red-500/10 text-red-400',     text: 'text-red-400'   },
  amber: { border: 'border-amber-500/30', icon: 'bg-amber-500/10 text-amber-400', text: 'text-amber-400' },
};

export function StatCard({ label, value, icon, color, sub }: StatCardProps) {
  const c = colorMap[color];
  return (
    <div className={clsx('glass rounded-2xl p-5 border', c.border, 'animate-slide-up')}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400 font-medium">{label}</p>
          <p className={clsx('text-2xl font-bold mt-1', c.text)}>{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        <div className={clsx('p-3 rounded-xl', c.icon)}>{icon}</div>
      </div>
    </div>
  );
}
