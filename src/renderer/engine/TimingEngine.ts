// ---------------------------------------------------------------------------
// GH2-style rules: one hit window, 50 points per gem, streak multiplier that
// tops out at 4x, sustains paying per beat, star power doubling everything,
// and a rock meter that fails the song when it bottoms out.
// ---------------------------------------------------------------------------

/** Single hit window — inside it a strum connects, outside it whiffs. */
export const HIT_WINDOW_MS = 100;

export const NOTE_SCORE = 50;

/** Sustain payout while the fret is held. */
export const SUSTAIN_SCORE_PER_BEAT = 25;

/** Streak multiplier: x2 at 10, x3 at 20, x4 at 30. Star power doubles it. */
export function multiplierFor(combo: number): number {
  if (combo >= 30) return 4;
  if (combo >= 20) return 3;
  if (combo >= 10) return 2;
  return 1;
}

// Rock meter, in percent of the gauge.
export const ROCK_START = 50;
export const ROCK_HIT = 2;
export const ROCK_MISS = -4;
export const ROCK_OVERSTRUM = -2;

// Star power.
export const SP_PHRASE_GAIN = 0.25;
export const SP_MIN_ACTIVATE = 0.5;
/** A full star power bar lasts this many beats. */
export const SP_DRAIN_BEATS = 32;

export function accuracyOf(notesHit: number, notesMissed: number): number {
  const total = notesHit + notesMissed;
  if (total === 0) return 100;
  return (notesHit / total) * 100;
}

export function starsFor(accuracy: number, fullCombo: boolean, failed: boolean): number {
  if (failed) return 0;
  if (fullCombo && accuracy >= 90) return 5;
  if (accuracy >= 97) return 5;
  if (accuracy >= 90) return 4;
  if (accuracy >= 75) return 3;
  if (accuracy >= 55) return 2;
  return 1;
}
