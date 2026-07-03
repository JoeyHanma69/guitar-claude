import type { GeneratedSong, Lane, Note, SongDef, SongSection } from '../types';

// ---------------------------------------------------------------------------
// Deterministic procedural song generation — GH2-style charts.
//
// Every song is generated from a fixed seed, so the same chart comes out on
// every run. Charts are built the way guitar music works: each section gets a
// RIFF (a short bar-length pattern anchored on a root note) which repeats
// with small variations, power chords sit on root+fifth lane shapes, metal
// songs add gallop rhythms, and every section ends in a descending fill run.
//
// After the raw notes are placed, three GH2 passes run:
//   - sustains: lonely notes before a long gap grow hold tails
//   - HOPOs: fast lane-changing notes become hammer-ons/pull-offs
//   - star phrases: evenly spread note runs that charge star power
// ---------------------------------------------------------------------------

export const SONGS: SongDef[] = [
  {
    id: 'whiskey-highway',
    title: 'Whiskey Highway',
    style: 'Hard Rock',
    difficulty: 'easy',
    bpm: 112,
    duration: 90_000,
    targetNotes: 120,
    seed: 0x51ab5,
    chordChance: 0,
    tripletChance: 0,
    gallopChance: 0,
    sustainChance: 0.4,
  },
  {
    id: 'iron-serpent',
    title: 'Iron Serpent',
    style: 'Heavy Metal',
    difficulty: 'medium',
    bpm: 138,
    duration: 120_000,
    targetNotes: 250,
    seed: 0xd00d5,
    chordChance: 0.2,
    tripletChance: 0,
    gallopChance: 0.12,
    sustainChance: 0.3,
  },
  {
    id: 'blast-beat-inferno',
    title: 'Blast Beat Inferno',
    style: 'Thrash Metal',
    difficulty: 'hard',
    bpm: 166,
    duration: 150_000,
    targetNotes: 430,
    seed: 0xba5e666,
    chordChance: 0.22,
    tripletChance: 0.12,
    gallopChance: 0.2,
    sustainChance: 0.2,
  },
];

/** Small, fast, seedable PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SECTION_LAYOUT: Array<{ name: SongSection['name']; frac: number; density: number }> = [
  { name: 'intro', frac: 0.1, density: 0.35 },
  { name: 'verse', frac: 0.25, density: 0.65 },
  { name: 'chorus', frac: 0.25, density: 1.0 },
  { name: 'bridge', frac: 0.18, density: 0.55 },
  { name: 'outro', frac: 0.22, density: 0.4 },
];

function buildSections(duration: number): SongSection[] {
  const sections: SongSection[] = [];
  let t = 0;
  for (const s of SECTION_LAYOUT) {
    const end = t + duration * s.frac;
    sections.push({ name: s.name, start: t, end, density: s.density });
    t = end;
  }
  sections[sections.length - 1].end = duration;
  return sections;
}

/**
 * Note probability at a point in time: section density scaled by a bell curve
 * peaking ~60% through the song (dynamic difficulty).
 */
function densityAt(sections: SongSection[], time: number, duration: number): number {
  const section =
    sections.find((s) => time >= s.start && time < s.end) ?? sections[sections.length - 1];
  const x = time / duration;
  const ramp = 0.7 + 0.6 * Math.exp(-((x - 0.6) ** 2) / 0.08);
  return section.density * ramp;
}

function sectionIndexAt(sections: SongSection[], time: number): number {
  for (let i = 0; i < sections.length; i += 1) {
    if (time < sections[i].end) return i;
  }
  return sections.length - 1;
}

const clampLane = (n: number): Lane => Math.max(0, Math.min(4, n)) as Lane;

interface RiffSlot {
  /** Lanes hit on this slot, or null for a rest. */
  lanes: Lane[] | null;
  gallop: boolean;
}

/**
 * A riff: short lane pattern that keeps returning to its root note, the way
 * a guitarist rides the low string. Power chords land as root+fifth shapes
 * (two lanes apart).
 */
function buildRiff(rng: () => number, def: SongDef, length: number): RiffSlot[] {
  const restChance =
    def.difficulty === 'easy' ? 0.2 : def.difficulty === 'medium' ? 0.3 : 0.22;
  const root = (rng() < 0.6 ? 0 : 1) as Lane;
  let current: Lane = root;
  const slots: RiffSlot[] = [];
  for (let i = 0; i < length; i += 1) {
    if (i !== 0 && rng() < restChance) {
      slots.push({ lanes: null, gallop: false });
      continue;
    }
    if (rng() < 0.45) current = root;
    else current = clampLane(current + (rng() < 0.5 ? 1 : -1) * (rng() < 0.25 ? 2 : 1));
    const lanes = new Set<Lane>([current]);
    if (rng() < def.chordChance * 2) lanes.add(clampLane(current + 2));
    slots.push({ lanes: [...lanes], gallop: rng() < def.gallopChance * 2 });
  }
  return slots;
}

/** Notes sitting before a long gap grow GH2 hold tails. */
function markSustains(rng: () => number, notes: Note[], beat: number, chance: number): void {
  for (let i = 0; i < notes.length; i += 1) {
    const n = notes[i];
    if (n.chord) continue;
    let j = i + 1;
    while (j < notes.length && notes[j].time === n.time) j += 1;
    if (j >= notes.length) continue;
    const gap = notes[j].time - n.time;
    if (gap < beat * 1.8) continue;
    if (rng() >= chance) continue;
    n.duration = Math.round(Math.min(gap - beat * 0.5, beat * 4));
  }
}

/**
 * Hammer-ons/pull-offs: a fast note on a different lane than its predecessor
 * can be hit by fretting alone, no strum, as long as the streak is alive.
 */
function markHopos(notes: Note[], beat: number): void {
  const threshold = Math.min(beat * 0.55, 185);
  for (let i = 1; i < notes.length; i += 1) {
    const n = notes[i];
    if (n.chord) continue;
    const prev = notes[i - 1];
    if (prev.time === n.time) continue;
    if (n.time - prev.time <= threshold && n.lane !== prev.lane) n.hopo = true;
  }
}

/** Evenly spread runs of notes that charge the star power gauge. */
function markStarPhrases(rng: () => number, notes: Note[]): void {
  if (notes.length < 30) return;
  const phraseCount = Math.max(4, Math.min(8, Math.round(notes.length / 55)));
  const span = notes.length / (phraseCount + 1);
  let phraseId = 0;
  for (let k = 1; k <= phraseCount; k += 1) {
    let start = Math.floor(span * k + (rng() - 0.5) * span * 0.3);
    start = Math.max(0, Math.min(notes.length - 6, start));
    while (start > 0 && notes[start - 1].time === notes[start].time) start -= 1;
    let end = Math.min(notes.length - 1, start + 4 + Math.floor(rng() * 5));
    while (end < notes.length - 1 && notes[end + 1].time === notes[end].time) end += 1;
    let overlaps = false;
    for (let i = start; i <= end; i += 1) {
      if (notes[i].starPhrase !== null) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    for (let i = start; i <= end; i += 1) notes[i].starPhrase = phraseId;
    phraseId += 1;
  }
}

export function generateSong(def: SongDef): GeneratedSong {
  const rng = mulberry32(def.seed);
  const sections = buildSections(def.duration);
  const beat = 60_000 / def.bpm;
  const step = def.difficulty === 'easy' ? beat : beat / 2;
  const leadIn = 3000;
  const tail = 2500;
  const riffLength = def.difficulty === 'easy' ? 8 : 16;

  // One riff per section: intro/verse/chorus/bridge/outro each get their own
  // motif, and the motif repeats bar after bar within the section.
  const riffs = sections.map(() => buildRiff(rng, def, riffLength));

  interface GridStep {
    t: number;
    section: number;
    idx: number;
  }
  const grid: GridStep[] = [];
  let idx = 0;
  let prevSection = -1;
  for (let t = leadIn; t < def.duration - tail; t += step) {
    const section = sectionIndexAt(sections, t);
    if (section !== prevSection) {
      idx = 0;
      prevSection = section;
    }
    grid.push({ t, section, idx });
    idx += 1;
  }

  // Calibrate the probability gate so the expected note count (including the
  // expected chord/gallop/triplet extras and section fills) lands near target.
  const carriers = grid.filter((g) => riffs[g.section][g.idx % riffLength].lanes !== null);
  const totalWeight = carriers.reduce(
    (acc, g) => acc + densityAt(sections, g.t, def.duration),
    0,
  );
  const extrasPerNote = def.chordChance * 2 + def.gallopChance * 2 + def.tripletChance * 2;
  const fillNotes = sections.length * 4;
  const scale =
    Math.max(1, def.targetNotes - fillNotes) / Math.max(1, totalWeight * (1 + extrasPerNote));

  const notes: Note[] = [];
  let id = 0;
  const lastLaneTime = [-1e9, -1e9, -1e9, -1e9, -1e9];
  const minGap = def.difficulty === 'hard' ? 85 : def.difficulty === 'medium' ? 100 : 300;

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

  for (const g of grid) {
    const sectionEnd = sections[g.section].end;

    // Section-ending fill: a short descending run that lands on the low lane.
    const stepsLeft = Math.floor((sectionEnd - g.t) / step);
    if (stepsLeft < 4) {
      push(g.t, clampLane(Math.min(4, stepsLeft + 1)), false);
      continue;
    }

    const slot = riffs[g.section][g.idx % riffLength];
    if (!slot.lanes) continue;
    const probability = Math.min(0.95, densityAt(sections, g.t, def.duration) * scale);
    if (rng() >= probability) continue;

    // Occasional transposition so the repeats don't feel copy-pasted.
    let lanes = slot.lanes;
    if (rng() < 0.1) {
      const shift = rng() < 0.5 ? 1 : -1;
      lanes = [...new Set(lanes.map((lane) => clampLane(lane + shift)))];
    }
    const isChord = lanes.length > 1;
    lanes.forEach((lane) => push(g.t, lane, isChord));

    // Gallop: an extra sixteenth right behind the main hit on the same lane.
    if (slot.gallop) push(g.t + step / 2, lanes[0], false);

    // Triplets (hard only): a fast sweep across adjacent lanes.
    if (def.tripletChance > 0 && rng() < def.tripletChance) {
      const dir = lanes[0] < 2 ? 1 : -1;
      for (let k = 1; k <= 2; k += 1) {
        push(g.t + (beat / 3) * k, clampLane(lanes[0] + dir * k), false);
      }
    }
  }

  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  markSustains(rng, notes, beat, def.sustainChance);
  markHopos(notes, beat);
  markStarPhrases(rng, notes);
  return { ...def, sections, notes };
}
