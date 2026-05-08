import clsx from 'clsx';

type EmptyAsset = 'transactions' | 'debts' | 'reports' | 'categories' | 'backups' | 'chat';

interface EmptyStateProps {
  asset: EmptyAsset;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

const assetMap: Record<EmptyAsset, string> = {
  transactions: '/assets/illustrations/empty-transactions.svg',
  debts: '/assets/illustrations/empty-debts.svg',
  reports: '/assets/illustrations/empty-reports.svg',
  categories: '/assets/illustrations/empty-categories.svg',
  backups: '/assets/illustrations/empty-backups.svg',
  chat: '/assets/illustrations/empty-chat.svg',
};

export function EmptyState({ asset, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={clsx('flex min-h-56 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-700/50 bg-slate-900/30 p-8 text-center', className)}>
      <img src={assetMap[asset]} alt="" className="empty-illustration mb-3 h-32 w-auto max-w-full" loading="lazy" />
      <h3 className="text-base font-black text-slate-100">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
