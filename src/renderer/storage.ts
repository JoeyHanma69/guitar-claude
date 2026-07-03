import type { HighScores, Settings } from './types';
import { DEFAULT_SETTINGS } from './constants';

// Persistence goes through the Electron IPC bridge when available and falls
// back to localStorage so the renderer also runs in a plain browser tab
// (useful for quick UI iteration with `vite preview`).

const hasBridge = (): boolean => typeof window !== 'undefined' && Boolean(window.nfAPI);

function sanitizeSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const merged: Settings = { ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) };
  if (
    !Array.isArray(merged.keyBindings) ||
    merged.keyBindings.length !== 5 ||
    merged.keyBindings.some((k) => typeof k !== 'string')
  ) {
    merged.keyBindings = [...DEFAULT_SETTINGS.keyBindings];
  }
  merged.masterVolume = clamp01(merged.masterVolume);
  merged.sfxVolume = clamp01(merged.sfxVolume);
  merged.musicVolume = clamp01(merged.musicVolume);
  if (![1, 1.25, 1.5, 2].includes(merged.noteSpeed)) merged.noteSpeed = 1;
  if (typeof merged.strumMode !== 'boolean') merged.strumMode = DEFAULT_SETTINGS.strumMode;
  return merged;
}

function clamp01(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0.8;
  return Math.min(1, Math.max(0, v));
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = hasBridge()
      ? await window.nfAPI!.getSettings()
      : JSON.parse(localStorage.getItem('nf-settings') ?? 'null');
    return sanitizeSettings(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    if (hasBridge()) await window.nfAPI!.saveSettings(settings);
    else localStorage.setItem('nf-settings', JSON.stringify(settings));
  } catch (err) {
    console.error('failed to save settings', err);
  }
}

export async function loadHighScores(): Promise<HighScores> {
  try {
    const raw = hasBridge()
      ? await window.nfAPI!.getHighScores()
      : JSON.parse(localStorage.getItem('nf-highscores') ?? 'null');
    if (!raw || typeof raw !== 'object') return {};
    return raw as HighScores;
  } catch {
    return {};
  }
}

export async function saveHighScores(scores: HighScores): Promise<void> {
  try {
    if (hasBridge()) await window.nfAPI!.saveHighScores(scores);
    else localStorage.setItem('nf-highscores', JSON.stringify(scores));
  } catch (err) {
    console.error('failed to save high scores', err);
  }
}
