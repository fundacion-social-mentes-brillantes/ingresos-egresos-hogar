import clsx from 'clsx';
import { Mars, Venus } from 'lucide-react';
import { useVisualMode } from '../../hooks/useVisualMode';
import type { VisualMode } from '../../lib/visualMode';

interface VisualModeToggleProps {
  className?: string;
  compact?: boolean;
}

const options: Array<{
  value: VisualMode;
  label: string;
  detail: string;
  icon: typeof Mars;
}> = [
  { value: 'man', label: 'Hombre', detail: 'Actual', icon: Mars },
  { value: 'woman', label: 'Mujer', detail: 'Lilipink', icon: Venus },
];

export function VisualModeToggle({ className, compact }: VisualModeToggleProps) {
  const { visualMode, setVisualMode } = useVisualMode();

  return (
    <div className={clsx('visual-mode-toggle', compact && 'visual-mode-toggle-compact', className)}>
      {!compact && (
        <div className="visual-mode-toggle-header">
          <span>Version visual</span>
          <strong>{visualMode === 'woman' ? 'Mujer' : 'Hombre'}</strong>
        </div>
      )}
      <div className="visual-mode-track" role="group" aria-label="Seleccionar modo visual">
        {options.map(({ value, label, detail, icon: Icon }) => {
          const active = visualMode === value;

          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => setVisualMode(value)}
              className={clsx('visual-mode-option', active && 'visual-mode-option-active')}
            >
              <Icon className="h-4 w-4" />
              <span className="min-w-0">
                <span className="visual-mode-label">{label}</span>
                {!compact && <span className="visual-mode-detail">{detail}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
