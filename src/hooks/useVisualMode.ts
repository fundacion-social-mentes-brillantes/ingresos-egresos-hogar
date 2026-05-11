import { useCallback, useEffect, useState } from 'react';
import {
  VISUAL_MODE_EVENT,
  applyVisualMode,
  getStoredVisualMode,
  setStoredVisualMode,
  type VisualMode,
} from '../lib/visualMode';

export function useVisualMode() {
  const [visualMode, setVisualModeState] = useState<VisualMode>(() => getStoredVisualMode());

  useEffect(() => {
    const syncVisualMode = () => {
      const nextMode = getStoredVisualMode();
      applyVisualMode(nextMode);
      setVisualModeState(nextMode);
    };

    syncVisualMode();
    window.addEventListener('storage', syncVisualMode);
    window.addEventListener(VISUAL_MODE_EVENT, syncVisualMode);

    return () => {
      window.removeEventListener('storage', syncVisualMode);
      window.removeEventListener(VISUAL_MODE_EVENT, syncVisualMode);
    };
  }, []);

  const setVisualMode = useCallback((mode: VisualMode) => {
    setStoredVisualMode(mode);
    setVisualModeState(mode);
  }, []);

  return {
    visualMode,
    setVisualMode,
    isWomanMode: visualMode === 'woman',
  };
}
