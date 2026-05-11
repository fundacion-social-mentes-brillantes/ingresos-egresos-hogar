export type VisualMode = 'man' | 'woman';

export const VISUAL_MODE_STORAGE_KEY = 'visualMode';
export const VISUAL_MODE_EVENT = 'visual-mode-change';

export function isVisualMode(value: unknown): value is VisualMode {
  return value === 'man' || value === 'woman';
}

export function getStoredVisualMode(): VisualMode {
  if (typeof window === 'undefined') return 'man';

  const stored = window.localStorage.getItem(VISUAL_MODE_STORAGE_KEY);
  return isVisualMode(stored) ? stored : 'man';
}

export function applyVisualMode(mode: VisualMode): void {
  if (typeof document === 'undefined') return;

  document.body.classList.toggle('theme-man', mode === 'man');
  document.body.classList.toggle('theme-woman', mode === 'woman');
  document.body.classList.remove('theme-light');
  document.body.dataset.visualMode = mode;
}

export function setStoredVisualMode(mode: VisualMode): void {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(VISUAL_MODE_STORAGE_KEY, mode);
  applyVisualMode(mode);
  window.dispatchEvent(new CustomEvent(VISUAL_MODE_EVENT, { detail: { mode } }));
}
