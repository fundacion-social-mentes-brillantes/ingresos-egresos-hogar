import clsx from 'clsx';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export function Input({ label, error, icon, className, id, ...props }: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-slate-300">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            {icon}
          </span>
        )}
        <input
          id={inputId}
          {...props}
          className={clsx(
            'w-full rounded-xl bg-slate-800/60 border border-slate-600/50',
            'text-slate-100 placeholder:text-slate-500',
            'px-4 py-2.5 text-sm',
            'focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50',
            'transition-all duration-200',
            icon && 'pl-10',
            error && 'border-red-500/50',
            className
          )}
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, error, options, className, id, ...props }: SelectProps) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-slate-300">
          {label}
        </label>
      )}
      <select
        id={selectId}
        {...props}
        className={clsx(
          'w-full rounded-xl bg-slate-800/60 border border-slate-600/50',
          'text-slate-100 px-4 py-2.5 text-sm',
          'focus:outline-none focus:ring-2 focus:ring-blue-500/50',
          'transition-all duration-200',
          error && 'border-red-500/50',
          className
        )}
      >
        {options.map(o => (
          <option key={o.value} value={o.value} className="bg-slate-800">
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
