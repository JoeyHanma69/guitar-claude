import type { Settings } from './types';

/** GH2 fret order, left to right: Green, Red, Yellow, Blue, Orange. */
export const LANE_COLORS = ['#31d13c', '#e33529', '#f5c542', '#2f7de1', '#f28b1d'];

export const DEFAULT_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'];

/** Keys that count as a strum. */
export const STRUM_CODES = ['Enter', 'NumpadEnter', 'ShiftRight', 'ArrowDown', 'ArrowUp'];

/** How long a note is visible before it reaches the strike line, at 1x speed. */
export const APPROACH_MS = 1800;

export const NOTE_SPEEDS = [1, 1.25, 1.5, 2];

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.5,
  keyBindings: [...DEFAULT_KEYS],
  screenShake: true,
  noteSpeed: 1,
  fullscreen: false,
  strumMode: true,
};

export const MISS_COLOR = '#ff2a4d';
export const STAR_COLOR = '#eef4ff';

/** Human-readable label for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const special: Record<string, string> = {
    Space: 'SPACE',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
  };
  return special[code] ?? code.toUpperCase();
}
