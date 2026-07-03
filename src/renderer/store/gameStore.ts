import { create } from 'zustand';
import type { GeneratedSong, HighScores, ResultStats, Settings, SongDef } from '../types';
import {
  accuracyOf,
  multiplierFor,
  NOTE_SCORE,
  ROCK_HIT,
  ROCK_MISS,
  ROCK_OVERSTRUM,
  ROCK_START,
  starsFor,
} from '../engine/TimingEngine';
import { generateSong } from '../engine/NoteGenerator';
import { loadHighScores, loadSettings, saveHighScores, saveSettings } from '../storage';
import { DEFAULT_SETTINGS } from '../constants';

export type GamePhase = 'menu' | 'playing' | 'gameover';

interface GameStore {
  phase: GamePhase;
  song: GeneratedSong | null;
  paused: boolean;
  muted: boolean;
  loaded: boolean;
  score: number;
  combo: number;
  maxCombo: number;
  notesHit: number;
  notesMissed: number;
  overstrums: number;
  /** Rock meter, 0..100. Bottoming out fails the song. */
  rockMeter: number;
  /** Star power gauge, 0..1. */
  starPower: number;
  spActive: boolean;
  settings: Settings;
  highScores: HighScores;
  result: ResultStats | null;

  init: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => void;
  startGame: (def: SongDef) => void;
  restartGame: () => void;
  registerHit: (gems: number) => void;
  registerMiss: (gems: number) => void;
  registerOverstrum: () => void;
  addSustainScore: (points: number) => void;
  setStarPower: (value: number) => void;
  setSpActive: (active: boolean) => void;
  setPaused: (paused: boolean) => void;
  toggleMute: () => void;
  finishGame: (failed: boolean, completion: number) => void;
  quitToMenu: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  phase: 'menu',
  song: null,
  paused: false,
  muted: false,
  loaded: false,
  score: 0,
  combo: 0,
  maxCombo: 0,
  notesHit: 0,
  notesMissed: 0,
  overstrums: 0,
  rockMeter: ROCK_START,
  starPower: 0,
  spActive: false,
  settings: { ...DEFAULT_SETTINGS },
  highScores: {},
  result: null,

  init: async () => {
    const [settings, highScores] = await Promise.all([loadSettings(), loadHighScores()]);
    set({ settings, highScores, loaded: true });
    if (settings.fullscreen) void window.nfAPI?.setFullscreen(true);
  },

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    void saveSettings(settings);
    if ('fullscreen' in patch) void window.nfAPI?.setFullscreen(Boolean(patch.fullscreen));
  },

  startGame: (def) => {
    set({
      song: generateSong(def),
      phase: 'playing',
      paused: false,
      score: 0,
      combo: 0,
      maxCombo: 0,
      notesHit: 0,
      notesMissed: 0,
      overstrums: 0,
      rockMeter: ROCK_START,
      starPower: 0,
      spActive: false,
      result: null,
    });
  },

  restartGame: () => {
    const { song } = get();
    if (!song) return;
    // Regenerating from the same seed produces an identical, fresh chart.
    get().startGame(song);
  },

  registerHit: (gems) => {
    set((s) => {
      const combo = s.combo + 1;
      const multiplier = multiplierFor(combo) * (s.spActive ? 2 : 1);
      return {
        combo,
        maxCombo: Math.max(s.maxCombo, combo),
        score: s.score + NOTE_SCORE * gems * multiplier,
        notesHit: s.notesHit + gems,
        rockMeter: Math.min(100, s.rockMeter + ROCK_HIT * gems),
      };
    });
  },

  registerMiss: (gems) => {
    set((s) => ({
      combo: 0,
      notesMissed: s.notesMissed + gems,
      rockMeter: Math.max(0, s.rockMeter + ROCK_MISS * gems),
    }));
  },

  registerOverstrum: () => {
    set((s) => ({
      combo: 0,
      overstrums: s.overstrums + 1,
      rockMeter: Math.max(0, s.rockMeter + ROCK_OVERSTRUM),
    }));
  },

  addSustainScore: (points) => {
    set((s) => ({
      score: s.score + Math.round(points * multiplierFor(s.combo) * (s.spActive ? 2 : 1)),
    }));
  },

  setStarPower: (value) => set({ starPower: Math.max(0, Math.min(1, value)) }),

  setSpActive: (active) => set({ spActive: active }),

  setPaused: (paused) => set({ paused }),

  toggleMute: () => set((s) => ({ muted: !s.muted })),

  finishGame: (failed, completion) => {
    const s = get();
    if (!s.song || s.phase !== 'playing') return;
    const notesTotal = s.song.notes.length;
    const accuracy = accuracyOf(s.notesHit, s.notesMissed);
    const fullCombo = !failed && s.notesMissed === 0 && s.overstrums === 0 && s.notesHit > 0;
    const key = s.song.id;
    const previous = s.highScores[key];
    const newRecord = !failed && (!previous || s.score > previous.score);
    const highScores: HighScores = newRecord
      ? {
          ...s.highScores,
          [key]: {
            score: s.score,
            accuracy,
            maxCombo: s.maxCombo,
            fullCombo,
            date: new Date().toISOString(),
          },
        }
      : s.highScores;
    if (newRecord) void saveHighScores(highScores);

    const result: ResultStats = {
      score: s.score,
      accuracy,
      maxCombo: s.maxCombo,
      notesHit: s.notesHit,
      notesTotal,
      overstrums: s.overstrums,
      fullCombo,
      stars: starsFor(accuracy, fullCombo, failed),
      newRecord,
      failed,
      completion: Math.max(0, Math.min(1, completion)),
    };
    set({ phase: 'gameover', paused: false, spActive: false, highScores, result });
  },

  quitToMenu: () => set({ phase: 'menu', song: null, paused: false, result: null }),
}));

// Dev-only hook so the store can be inspected/driven from the console.
if (import.meta.env.DEV) {
  (window as unknown as { __nfStore?: typeof useGameStore }).__nfStore = useGameStore;
}
