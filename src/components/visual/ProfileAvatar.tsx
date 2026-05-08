import clsx from 'clsx';

interface ProfileAvatarProps {
  src?: string | null;
  initials: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeMap = {
  sm: 'h-9 w-9 text-sm',
  md: 'h-12 w-12 text-base',
  lg: 'h-16 w-16 text-xl',
  xl: 'h-24 w-24 text-3xl',
};

export function ProfileAvatar({ src, initials, size = 'md', className }: ProfileAvatarProps) {
  return (
    <span
      className={clsx(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-gradient-to-br from-blue-500 via-violet-500 to-cyan-400 font-black text-white shadow-lg shadow-blue-500/20',
        sizeMap[size],
        className
      )}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span>{initials}</span>}
      <span className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/20" />
    </span>
  );
}
