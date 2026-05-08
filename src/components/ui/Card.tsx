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
        'lux-card lux-card-hover p-5',
        gradient && 'bg-gradient-to-br from-blue-600/20 via-violet-600/10 to-cyan-500/10',
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
  blue:  { border: 'border-blue-500/30',  icon: 'bg-blue-500/10 text-blue-400',  text: 'text-blue-300'  },
  green: { border: 'border-green-500/30', icon: 'bg-green-500/10 text-green-400', text: 'text-green-300' },
  red:   { border: 'border-red-500/30',   icon: 'bg-red-500/10 text-red-400',     text: 'text-red-300'   },
  amber: { border: 'border-amber-500/30', icon: 'bg-amber-500/10 text-amber-400', text: 'text-amber-300' },
};

export function StatCard({ label, value, icon, color, sub }: StatCardProps) {
  const c = colorMap[color];
  return (
    <div className={clsx('metric-card p-5 border animate-slide-up', c.border)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className={clsx('mt-2 text-2xl font-black leading-tight', c.text)}>{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        <div className={clsx('premium-icon p-3', c.icon)}>{icon}</div>
      </div>
    </div>
  );
}
