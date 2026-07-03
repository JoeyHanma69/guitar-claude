import type { Difficulty, GeneratedSong, Lane, Note } from '../types';
import { buildSections, markHopos, markStarPhrases } from './NoteGenerator';

// ---------------------------------------------------------------------------
// Song import: turn any audio file into a playable chart.
//
// The pipeline is classic onset detection, kept dependency-free:
//   1. decode + mixdown to mono
//   2. split into low/mid/high bands with one-pole filters
//   3. energy per ~12ms hop → novelty curve (energy rise over local average)
//   4. adaptive peak picking = onsets; thin out until density is playable
//   5. tempo from the folded inter-onset-interval histogram
//   6. lanes from which band dominates each onset (bass riffs sit low,
//      cymbals/leads sit high), chords on the strongest low hits,
//      sustains where the sound rings into a long gap
//   7. reuse the procedural pipeline's HOPO + star-phrase passes
//
// The original audio plays back during gameplay; the chart is offset by the
// same 3s countdown the procedural songs use.
// ---------------------------------------------------------------------------

const HOP = 512;
const LEAD_IN = 3000;
/** Hard ceiling on chart density, notes per second. */
const MAX_NPS = 6;

const clampLane = (n: number): Lane => Math.max(0, Math.min(4, n)) as Lane;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mixdown(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) out[i] += data[i] / channels;
  }
  return out;
}

interface FrameEnergies {
  total: Float32Array;
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  hopMs: number;
}

/** Per-hop energy in three bands via one-pole low-pass splits (200Hz / 2kHz). */
function frameEnergies(samples: Float32Array, sampleRate: number): FrameEnergies {
  const frames = Math.max(1, Math.floor(samples.length / HOP));
  const total = new Float32Array(frames);
  const low = new Float32Array(frames);
  const mid = new Float32Array(frames);
  const high = new Float32Array(frames);
  const aLow = 1 - Math.exp((-2 * Math.PI * 200) / sampleRate);
  const aMid = 1 - Math.exp((-2 * Math.PI * 2000) / sampleRate);
  let lp200 = 0;
  let lp2k = 0;
  for (let i = 0; i < frames * HOP; i += 1) {
    const x = samples[i];
    lp200 += aLow * (x - lp200);
    lp2k += aMid * (x - lp2k);
    const bandLow = lp200;
    const bandMid = lp2k - lp200;
    const bandHigh = x - lp2k;
    const f = (i / HOP) | 0;
    total[f] += x * x;
    low[f] += bandLow * bandLow;
    mid[f] += bandMid * bandMid;
    high[f] += bandHigh * bandHigh;
  }
  return { total, low, mid, high, hopMs: (HOP / sampleRate) * 1000 };
}

/** Energy-rise novelty: how much louder this frame is than the recent past. */
function noveltyCurve(total: Float32Array): Float32Array {
  const n = new Float32Array(total.length);
  const history = 8;
  for (let i = 1; i < total.length; i += 1) {
    let past = 0;
    let count = 0;
    for (let k = Math.max(0, i - history); k < i; k += 1) {
      past += total[k];
      count += 1;
    }
    n[i] = Math.max(0, total[i] - past / Math.max(1, count));
  }
  return n;
}

interface Onset {
  timeMs: number;
  frame: number;
  strength: number;
}

function pickOnsets(novelty: Float32Array, hopMs: number, durationMs: number): Onset[] {
  const minGapFrames = Math.max(1, Math.round(100 / hopMs));
  const window = 20;
  let onsets: Onset[] = [];
  for (let i = 2; i < novelty.length - 2; i += 1) {
    const v = novelty[i];
    if (v <= 0) continue;
    if (v < novelty[i - 1] || v < novelty[i + 1]) continue; // local max only
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - window); k < Math.min(novelty.length, i + window); k += 1) {
      sum += novelty[k];
      count += 1;
    }
    const threshold = (sum / Math.max(1, count)) * 1.5 + 1e-6;
    if (v < threshold) continue;
    const last = onsets[onsets.length - 1];
    if (last && i - last.frame < minGapFrames) {
      if (v > last.strength) onsets[onsets.length - 1] = { timeMs: i * hopMs, frame: i, strength: v };
      continue;
    }
    onsets.push({ timeMs: i * hopMs, frame: i, strength: v });
  }
  // Thin the weakest onsets until the density is humanly playable.
  const maxNotes = Math.max(20, Math.floor((durationMs / 1000) * MAX_NPS));
  if (onsets.length > maxNotes) {
    const sorted = [...onsets].sort((a, b) => b.strength - a.strength).slice(0, maxNotes);
    const keep = new Set(sorted.map((o) => o.frame));
    onsets = onsets.filter((o) => keep.has(o.frame));
  }
  return onsets;
}

/** Tempo from the folded histogram of inter-onset intervals (60–200 BPM). */
function estimateBpm(onsets: Onset[]): number {
  if (onsets.length < 8) return 120;
  const bins = new Map<number, number>();
  for (let i = 1; i < onsets.length; i += 1) {
    for (let span = 1; span <= 2 && i - span >= 0; span += 1) {
      const interval = onsets[i].timeMs - onsets[i - span].timeMs;
      if (interval < 60) continue;
      let bpm = 60_000 / interval;
      while (bpm < 60) bpm *= 2;
      while (bpm > 200) bpm /= 2;
      const bin = Math.round(bpm / 2) * 2;
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
  }
  let best = 120;
  let bestCount = 0;
  for (const [bpm, count] of bins) {
    if (count > bestCount) {
      best = bpm;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Analyze a decoded audio buffer into a playable chart.
 * Deterministic for the same audio + name, so high scores stay meaningful.
 */
export function analyzeBuffer(buffer: AudioBuffer, name: string): GeneratedSong {
  const durationMs = Math.round(buffer.duration * 1000);
  if (durationMs < 15_000) throw new Error('Song too short — needs at least 15 seconds.');

  const samples = mixdown(buffer);
  const bands = frameEnergies(samples, buffer.sampleRate);
  const novelty = noveltyCurve(bands.total);
  const onsets = pickOnsets(novelty, bands.hopMs, durationMs);
  if (onsets.length < 20) {
    throw new Error('Could not find enough beats in this audio — try a punchier track.');
  }
  const bpm = estimateBpm(onsets);
  const beat = 60_000 / bpm;

  const seed = hashString(`${name}:${buffer.length}`);
  const rng = mulberry32(seed);
  const strengths = [...onsets.map((o) => o.strength)].sort((a, b) => a - b);
  const strongCut = strengths[Math.floor(strengths.length * 0.85)] ?? Infinity;

  const notes: Note[] = [];
  let id = 0;
  const lastLaneTime = [-1e9, -1e9, -1e9, -1e9, -1e9];
  const minGap = 90;
  const push = (time: number, lane: Lane, chord: boolean): void => {
    if (time - lastLaneTime[lane] < minGap) return;
    lastLaneTime[lane] = time;
    notes.push({
      id: id++,
      lane,
      time: Math.round(time),
      duration: 0,
      chord,
      hopo: false,
      starPhrase: null,
      judged: false,
      rating: null,
    });
  };

  let prevLane: Lane = 0;
  for (const onset of onsets) {
    const f = onset.frame;
    const lowE = bands.low[f];
    const midE = bands.mid[f];
    const highE = bands.high[f];
    const sum = lowE + midE + highE + 1e-12;

    // Which part of the spectrum hit: bass → left lanes, treble → right.
    let base: number;
    if (lowE / sum > 0.5) base = rng() < 0.6 ? 0 : 1;
    else if (highE / sum > 0.4) base = rng() < 0.6 ? 4 : 3;
    else base = 1 + Math.round(rng() * 2);
    // Bias toward small movements so runs feel like riffs, not noise.
    if (Math.abs(base - prevLane) > 2 && rng() < 0.5) {
      base = prevLane + (base > prevLane ? 2 : -2);
    }
    const lane = clampLane(base);
    prevLane = lane;

    const time = onset.timeMs + LEAD_IN;
    // The heaviest bass hits land as power chords.
    if (onset.strength >= strongCut && lowE / sum > 0.4) {
      push(time, lane, true);
      push(time, clampLane(lane + 2), true);
    } else {
      push(time, lane, false);
    }
  }

  // Sustains: a hit that rings into a long gap becomes a hold note.
  for (let i = 0; i < notes.length; i += 1) {
    const n = notes[i];
    if (n.chord) continue;
    let j = i + 1;
    while (j < notes.length && notes[j].time === n.time) j += 1;
    const gap = (j < notes.length ? notes[j].time : durationMs + LEAD_IN) - n.time;
    if (gap < beat * 1.8) continue;
    const startFrame = Math.min(bands.total.length - 1, Math.round((n.time - LEAD_IN) / bands.hopMs));
    const midFrame = Math.min(
      bands.total.length - 1,
      Math.round((n.time - LEAD_IN + gap / 2) / bands.hopMs),
    );
    if (bands.total[midFrame] > bands.total[startFrame] * 0.25) {
      n.duration = Math.round(Math.min(gap - beat * 0.4, beat * 4));
    }
  }

  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  markHopos(notes, beat);
  markStarPhrases(rng, notes);

  const nps = notes.length / (durationMs / 1000);
  const difficulty: Difficulty = nps < 1.8 ? 'easy' : nps < 3.2 ? 'medium' : 'hard';
  const title = name.replace(/\.[^.]+$/, '');
  const totalDuration = durationMs + LEAD_IN;

  return {
    id: `import-${seed.toString(16)}`,
    title,
    style: 'Imported',
    difficulty,
    bpm: Math.round(bpm),
    duration: totalDuration,
    targetNotes: notes.length,
    seed,
    chordChance: 0,
    tripletChance: 0,
    gallopChance: 0,
    sustainChance: 0,
    sections: buildSections(totalDuration),
    notes,
    buffer,
  };
}

/** File → decoded buffer → chart. */
export async function analyzeFile(file: File): Promise<GeneratedSong> {
  const bytes = await file.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(bytes);
    return analyzeBuffer(buffer, file.name);
  } catch (err) {
    if (err instanceof Error && err.message.includes('—')) throw err;
    throw new Error('Could not decode that file — try an MP3, WAV, OGG or M4A.');
  } finally {
    void ctx.close();
  }
}

// Dev-only hook so the analyzer can be exercised from the console.
if (import.meta.env.DEV) {
  (window as unknown as { __nfAnalyze?: typeof analyzeBuffer }).__nfAnalyze = analyzeBuffer;
}
