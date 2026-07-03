import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { STRUM_CODES } from '../constants';

export interface KeyboardHandlers {
  /** Fret key held/released (GH2 fret buttons). */
  onFret?: (lane: number, down: boolean) => void;
  /** Strum (Enter / Right Shift / arrow keys). */
  onStrum?: () => void;
  /** Star power activation (Space). */
  onStarPower?: () => void;
  onPauseToggle?: () => void;
  onRestart?: () => void;
  onMute?: () => void;
  /** Quit (Q — used from the pause overlay). */
  onQuit?: () => void;
}

/**
 * Global keyboard handling. Listeners sit on `window`, so gameplay keys work
 * regardless of which element has focus. Fret bindings are read from the
 * store at event time, so remapping applies instantly.
 */
export function useKeyboard(handlers: KeyboardHandlers, active = true): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!active) return undefined;

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      const { keyBindings } = useGameStore.getState().settings;
      const lane = keyBindings.indexOf(e.code);
      if (lane !== -1) {
        e.preventDefault();
        handlersRef.current.onFret?.(lane, true);
        return;
      }
      if (STRUM_CODES.includes(e.code)) {
        e.preventDefault();
        handlersRef.current.onStrum?.();
      } else if (e.code === 'Space') {
        e.preventDefault();
        handlersRef.current.onStarPower?.();
      } else if (e.code === 'Escape') {
        handlersRef.current.onPauseToggle?.();
      } else if (e.code === 'KeyR') {
        handlersRef.current.onRestart?.();
      } else if (e.code === 'KeyM') {
        handlersRef.current.onMute?.();
      } else if (e.code === 'KeyQ') {
        handlersRef.current.onQuit?.();
      }
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      const { keyBindings } = useGameStore.getState().settings;
      const lane = keyBindings.indexOf(e.code);
      if (lane !== -1) handlersRef.current.onFret?.(lane, false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [active]);
}
