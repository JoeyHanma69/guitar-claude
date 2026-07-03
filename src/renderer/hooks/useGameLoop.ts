import { useEffect, useRef } from 'react';

/**
 * requestAnimationFrame loop. The callback is kept in a ref so the loop never
 * restarts when the callback identity changes, and dt is clamped so a
 * backgrounded tab doesn't produce a giant catch-up step.
 */
export function useGameLoop(
  callback: (dtMs: number, nowMs: number) => void,
  active: boolean,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(now - last, 50);
      last = now;
      callbackRef.current(dt, now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}
