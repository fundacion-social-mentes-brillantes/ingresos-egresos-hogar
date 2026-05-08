import clsx from 'clsx';
import { getAccountBrandAsset } from '../../lib/accountBrandAssets';
import type { AccountType } from '../../types';

interface AccountBrandMarkProps {
  type?: AccountType | null;
  name?: string | null;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

const sizeMap = {
  sm: 'h-8 w-8 rounded-xl',
  md: 'h-11 w-11 rounded-2xl',
  lg: 'h-14 w-14 rounded-2xl',
};

export function AccountBrandMark({ type, name, size = 'md', showLabel, className }: AccountBrandMarkProps) {
  const brand = getAccountBrandAsset(type, name);

  return (
    <div className={clsx('flex items-center gap-2 min-w-0', className)}>
      <span
        className={clsx(
          'inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/15 shadow-lg',
          sizeMap[size]
        )}
        style={{ boxShadow: `0 14px 32px ${brand.accent}22` }}
      >
        <img src={brand.asset} alt="" className="h-full w-full object-cover" loading="lazy" />
      </span>
      {showLabel && (
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold text-slate-100">{name || brand.label}</span>
          <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{brand.label}</span>
        </span>
      )}
    </div>
  );
}
