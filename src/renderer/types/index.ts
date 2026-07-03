export type Lane = 0 | 1 | 2 | 3 | 4;

export type Difficulty = 'easy' | 'medium' | 'hard';

/** GH2-style judgement: a note is either hit inside the window or missed. */
export type NoteRating = 'hit' | 'miss';

export interface Note {
  id: number;
  lane: Lane;
  /** Milliseconds from song start at which the note crosses the strike line. */
  time: number;
  /** Sustain length in ms; 0 = normal tap note. */
  duration: number;
  /** True when the note is part of a simultaneous chord. */
  chord: boolean;
  /** Hammer-on/pull-off: hittable by fretting alone while the streak is alive. */
  hopo: boolean;
  /** Star-power phrase id, or null if not part of a phrase. */
  starPhrase: number | null;
  judged: boolean;
  rating: NoteRating | null;
}

export interface SongSection {
  name: 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';
  start: number;
  end: number;
  /** Relative note density for this section, 0..1. */
  density: number;
}

export interface SongDef {
  id: string;
  title: string;
  /** Genre label shown on the song card, e.g. "Thrash Metal". */
  style: string;
  difficulty: Difficulty;
  bpm: number;
  /** Song length in milliseconds. */
  duration: number;
  /** Approximate number of notes the generator aims for. */
  targetNotes: number;
  /** Seed for the deterministic generator. */
  seed: number;
  chordChance: number;
  tripletChance: number;
  /** Chance of a gallop rhythm (extra sixteenth after a hit). */
  gallopChance: number;
  /** Chance that an eligible long-gap note becomes a sustain. */
  sustainChance: number;
}

export interface GeneratedSong extends SongDef {
  notes: Note[];
  sections: SongSection[];
  /** Present on imported songs: the decoded audio to play during gameplay. */
  buffer?: AudioBuffer;
}

export interface Settings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  /** KeyboardEvent.code for each of the 5 frets, left (green) to right (orange). */
  keyBindings: string[];
  screenShake: boolean;
  /** Scroll speed multiplier: 1, 1.25, 1.5 or 2. */
  noteSpeed: number;
  fullscreen: boolean;
  /**
   * True = GH2 rules: hold fret + strum, overstrums penalized.
   * False = casual tap mode: fret keys hit notes directly, no strumming.
   */
  strumMode: boolean;
}

export interface HighScoreEntry {
  score: number;
  accuracy: number;
  maxCombo: number;
  fullCombo: boolean;
  date: string;
}

/** Keyed by song id. */
export type HighScores = Record<string, HighScoreEntry>;

export interface ResultStats {
  score: number;
  accuracy: number;
  maxCombo: number;
  notesHit: number;
  notesTotal: number;
  overstrums: number;
  fullCombo: boolean;
  stars: number;
  newRecord: boolean;
  /** True when the rock meter bottomed out before the song ended. */
  failed: boolean;
  /** How far through the song the run got, 0..1. */
  completion: number;
}

declare global {
  interface Window {
    nfAPI?: {
      getSettings: () => Promise<unknown>;
      saveSettings: (settings: Settings) => Promise<void>;
      getHighScores: () => Promise<unknown>;
      saveHighScores: (scores: HighScores) => Promise<void>;
      setFullscreen: (flag: boolean) => Promise<void>;
    };
  }
}
