import clsx from 'clsx';

type Variant = 'primary' | 'ghost' | 'danger' | 'success';
type Size    = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variants: Record<Variant, string> = {
  primary: 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20',
  ghost:   'bg-transparent hover:bg-slate-700/50 text-slate-300 border border-slate-600/50',
  danger:  'bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30',
  success: 'bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-500/30',
};

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2   text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center rounded-xl font-medium',
        'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : icon}
      {children}
    </button>
  );
}
