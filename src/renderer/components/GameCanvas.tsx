import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { useGameLoop } from '../hooks/useGameLoop';
import { useKeyboard } from '../hooks/useKeyboard';
import { audio } from '../hooks/useAudio';
import { ParticleSystem } from '../engine/ParticleSystem';
import {
  HIT_WINDOW_MS,
  multiplierFor,
  SP_DRAIN_BEATS,
  SP_MIN_ACTIVATE,
  SP_PHRASE_GAIN,
  SUSTAIN_SCORE_PER_BEAT,
} from '../engine/TimingEngine';
import type { Lane, Note } from '../types';
import { APPROACH_MS, LANE_COLORS, MISS_COLOR, STAR_COLOR, keyLabel } from '../constants';

// ---------------------------------------------------------------------------
// The GH2-style playfield: fret + strum input, HOPOs, sustains, star power
// and the rock meter all live here. All mutable per-frame state sits in a
// ref (never React state), so the 60fps loop causes zero re-renders; only
// judgements and gauge syncs touch the zustand store, which drives the HUD.
// ---------------------------------------------------------------------------

interface FloatText {
  text: string;
  color: string;
  x: number;
  y: number;
  life: number;
  maxLife: number;
}

interface AmbientDot {
  x: number;
  y: number;
  vy: number;
  r: number;
  a: number;
}

interface SustainTrack {
  lane: Lane;
  end: number;
  last: number;
}

interface PhraseState {
  total: number;
  hit: number;
  dead: boolean;
}

interface WorldState {
  notes: Note[];
  scanFrom: number;
  startAt: number;
  songTime: number;
  pauseStarted: number;
  finished: boolean;
  shake: number;
  laneFlash: number[];
  fretsHeld: boolean[];
  particles: ParticleSystem;
  floats: FloatText[];
  ambient: AmbientDot[];
  activeSustains: SustainTrack[];
  sustainPending: number;
  phrases: Map<number, PhraseState>;
  spGauge: number;
  spActive: boolean;
  spSyncAcc: number;
  beatMs: number;
  viewW: number;
  viewH: number;
  dpr: number;
  fps: number;
  fpsAcc: number;
  fpsFrames: number;
  showFps: boolean;
  lastMultiplier: number;
}

function freshWorld(): WorldState {
  return {
    notes: [],
    scanFrom: 0,
    startAt: 0,
    songTime: 0,
    pauseStarted: 0,
    finished: false,
    shake: 0,
    laneFlash: [0, 0, 0, 0, 0],
    fretsHeld: [false, false, false, false, false],
    particles: new ParticleSystem(),
    floats: [],
    ambient: [],
    activeSustains: [],
    sustainPending: 0,
    phrases: new Map(),
    spGauge: 0,
    spActive: false,
    spSyncAcc: 0,
    beatMs: 500,
    viewW: 1280,
    viewH: 720,
    dpr: 1,
    fps: 0,
    fpsAcc: 0,
    fpsFrames: 0,
    showFps: false,
    lastMultiplier: 1,
  };
}

// --- highway geometry -------------------------------------------------------

const HORIZON_FRAC = 0.06;
const STRIKE_FRAC = 0.78;

function laneGeometry(w: WorldState, y: number): { left: number; laneW: number } {
  const topY = w.viewH * HORIZON_FRAC;
  const t = Math.max(0, (y - topY) / (w.viewH - topY));
  const width = w.viewW * (0.24 + (0.66 - 0.24) * t);
  return { left: (w.viewW - width) / 2, laneW: width / 5 };
}

function laneCenterX(w: WorldState, lane: number, y: number): number {
  const { left, laneW } = laneGeometry(w, y);
  return left + laneW * (lane + 0.5);
}

/** Vertical position for note progress p (0 = spawn at horizon, 1 = strike). */
function yForProgress(w: WorldState, p: number): number {
  const topY = w.viewH * HORIZON_FRAC;
  const strikeY = w.viewH * STRIKE_FRAC;
  if (p <= 0) return topY;
  if (p <= 1) return topY + (strikeY - topY) * Math.pow(p, 1.6);
  // Past the strike line: continue at the arrival slope.
  return strikeY + (p - 1) * 1.6 * (strikeY - topY);
}

function approachMs(): number {
  return APPROACH_MS / useGameStore.getState().settings.noteSpeed;
}

export default function GameCanvas(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const world = useRef<WorldState>(freshWorld());
  const wasPaused = useRef(false);

  const song = useGameStore((s) => s.song);
  const paused = useGameStore((s) => s.paused);

  // --- per-song setup -------------------------------------------------------
  useEffect(() => {
    if (!song) return undefined;
    const w = world.current;
    Object.assign(w, freshWorld(), {
      viewW: w.viewW,
      viewH: w.viewH,
      dpr: w.dpr,
      showFps: w.showFps,
    });
    w.notes = song.notes.map((n) => ({ ...n }));
    w.beatMs = 60_000 / song.bpm;
    for (const n of w.notes) {
      if (n.starPhrase === null) continue;
      const p = w.phrases.get(n.starPhrase);
      if (p) p.total += 1;
      else w.phrases.set(n.starPhrase, { total: 1, hit: 0, dead: false });
    }
    for (let i = 0; i < 70; i += 1) {
      w.ambient.push({
        x: Math.random(),
        y: Math.random(),
        vy: 8 + Math.random() * 25,
        r: 0.6 + Math.random() * 1.8,
        a: 0.15 + Math.random() * 0.5,
      });
    }
    w.startAt = performance.now();
    if (song.buffer) audio.startTrack(song.buffer, 3000);
    else audio.startMusic(song.bpm);
    return () => {
      audio.stopMusic();
      audio.stopTrack();
      audio.resume(); // never leave the context suspended on unmount
    };
  }, [song]);

  // --- pause / resume -------------------------------------------------------
  useEffect(() => {
    const w = world.current;
    if (paused) {
      w.pauseStarted = performance.now();
      audio.suspend();
      wasPaused.current = true;
    } else if (wasPaused.current) {
      w.startAt += performance.now() - w.pauseStarted;
      audio.resume();
      wasPaused.current = false;
    }
  }, [paused]);

  // --- canvas sizing (keeps aspect with the window) --------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return undefined;
    const parent = canvas.parentElement;
    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      world.current.viewW = width;
      world.current.viewH = height;
      world.current.dpr = dpr;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  // Auto-pause when the window is hidden: rAF throttles to zero in background
  // tabs, so the chart would freeze while the audio kept playing.
  useEffect(() => {
    const onVisibility = (): void => {
      if (!document.hidden) return;
      const store = useGameStore.getState();
      if (store.phase === 'playing' && !store.paused && !world.current.finished) {
        store.setPaused(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // --- debug FPS toggle -------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'F3') world.current.showFps = !world.current.showFps;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- gameplay actions -------------------------------------------------------

  const strikeBurst = (lane: Lane, kind: 'flame' | 'shatter'): void => {
    const w = world.current;
    const strikeY = w.viewH * STRIKE_FRAC;
    w.particles.burst(laneCenterX(w, lane, strikeY), strikeY, kind);
  };

  const trackPhrase = (note: Note, hit: boolean): void => {
    const w = world.current;
    if (note.starPhrase === null) return;
    const phrase = w.phrases.get(note.starPhrase);
    if (!phrase || phrase.dead) return;
    if (!hit) {
      phrase.dead = true;
      return;
    }
    phrase.hit += 1;
    if (phrase.hit === phrase.total) {
      w.spGauge = Math.min(1, w.spGauge + SP_PHRASE_GAIN);
      useGameStore.getState().setStarPower(w.spGauge);
      const strikeY = w.viewH * STRIKE_FRAC;
      w.particles.burst(w.viewW / 2, strikeY - 60, 'star');
      w.floats.push({
        text: 'STAR POWER +25%',
        color: STAR_COLOR,
        x: w.viewW / 2,
        y: strikeY - 90,
        life: 800,
        maxLife: 800,
      });
    }
  };

  const hitGroup = (group: Note[]): void => {
    const w = world.current;
    const store = useGameStore.getState();
    for (const n of group) {
      n.judged = true;
      n.rating = 'hit';
      if (n.duration > 0) {
        w.activeSustains.push({ lane: n.lane, end: n.time + n.duration, last: w.songTime });
      }
      trackPhrase(n, true);
      w.laneFlash[n.lane] = 1;
      strikeBurst(n.lane, 'flame');
      audio.playHit(n.lane, n.duration / 1000);
    }
    store.registerHit(group.length);
    const multiplier = multiplierFor(useGameStore.getState().combo);
    if (multiplier > w.lastMultiplier) audio.comboUp();
    w.lastMultiplier = multiplier;
  };

  const doOverstrum = (): void => {
    const w = world.current;
    // A strum nowhere near any note (e.g. during the countdown) is ignored.
    const anyNear = w.notes.some(
      (n) => !n.judged && Math.abs(n.time - w.songTime) <= 1500,
    );
    if (!anyNear) return;
    useGameStore.getState().registerOverstrum();
    audio.overstrum();
    w.activeSustains = []; // overstrumming kills held sustains
    w.lastMultiplier = 1;
  };

  /** Tap mode (strum mode off): the fret key alone hits its lane's note. */
  const tapHit = (lane: number): void => {
    const w = world.current;
    let best: Note | null = null;
    let bestDelta = Infinity;
    for (let i = w.scanFrom; i < w.notes.length; i += 1) {
      const n = w.notes[i];
      if (n.time - w.songTime > HIT_WINDOW_MS) break;
      if (n.judged || n.lane !== lane) continue;
      const delta = Math.abs(w.songTime - n.time);
      if (delta <= HIT_WINDOW_MS && delta < bestDelta) {
        best = n;
        bestDelta = delta;
      }
    }
    if (best) hitGroup([best]);
  };

  const strum = (): void => {
    const w = world.current;
    const store = useGameStore.getState();
    if (store.paused || w.finished) return;
    if (!store.settings.strumMode) return; // tap mode: strumming is a no-op

    // Earliest unjudged note group (chord = same timestamp) inside the window.
    const group: Note[] = [];
    for (let i = w.scanFrom; i < w.notes.length; i += 1) {
      const n = w.notes[i];
      if (n.time - w.songTime > HIT_WINDOW_MS) break;
      if (n.judged || w.songTime - n.time > HIT_WINDOW_MS) continue;
      if (group.length === 0 || n.time === group[0].time) group.push(n);
      else break;
    }
    if (group.length === 0) {
      doOverstrum();
      return;
    }

    const lanes = group.map((n) => n.lane);
    const topLane = Math.max(...lanes);
    let fretsOk: boolean;
    if (group.length > 1) {
      // Chords need the exact fret shape.
      fretsOk = w.fretsHeld.every((held, lane) => held === lanes.includes(lane as Lane));
    } else {
      // Single notes allow anchoring lower frets under the played one.
      fretsOk =
        w.fretsHeld[topLane] && w.fretsHeld.every((held, lane) => !held || lane <= topLane);
    }
    if (!fretsOk) {
      doOverstrum();
      return;
    }
    hitGroup(group);
  };

  const onFret = (lane: number, down: boolean): void => {
    const w = world.current;
    w.fretsHeld[lane] = down;
    if (!down) {
      // Releasing the fret ends its sustain (no penalty — GH2 rules).
      w.activeSustains = w.activeSustains.filter((t) => t.lane !== lane);
      return;
    }
    const store = useGameStore.getState();
    if (store.paused || w.finished) return;

    if (!store.settings.strumMode) {
      tapHit(lane);
      return;
    }

    // HOPO: while the streak is alive, the next note can be hit by fretting
    // alone if the chart marks it as a hammer-on/pull-off.
    if (store.combo === 0) return;
    let head: Note | null = null;
    for (let i = w.scanFrom; i < w.notes.length; i += 1) {
      const n = w.notes[i];
      if (n.time - w.songTime > HIT_WINDOW_MS) break;
      if (n.judged || w.songTime - n.time > HIT_WINDOW_MS) continue;
      head = n;
      break;
    }
    if (head && head.hopo && !head.chord && head.lane === lane) {
      hitGroup([head]);
    }
  };

  const activateStarPower = (): void => {
    const w = world.current;
    const store = useGameStore.getState();
    if (store.paused || w.finished) return;
    if (w.spActive || w.spGauge < SP_MIN_ACTIVATE) return;
    w.spActive = true;
    store.setSpActive(true);
    audio.starPowerOn();
    const strikeY = w.viewH * STRIKE_FRAC;
    w.particles.burst(w.viewW / 2, strikeY - 40, 'star');
    w.floats.push({
      text: 'STAR POWER!',
      color: STAR_COLOR,
      x: w.viewW / 2,
      y: strikeY - 120,
      life: 900,
      maxLife: 900,
    });
  };

  useKeyboard({
    onFret,
    onStrum: strum,
    onStarPower: activateStarPower,
    onPauseToggle: () => {
      const store = useGameStore.getState();
      if (!world.current.finished) store.setPaused(!store.paused);
    },
    onRestart: () => useGameStore.getState().restartGame(),
    onMute: () => useGameStore.getState().toggleMute(),
    onQuit: () => {
      const store = useGameStore.getState();
      if (store.paused) store.quitToMenu();
    },
  });

  // --- per-frame simulation ---------------------------------------------------
  const step = (dt: number, now: number): void => {
    const w = world.current;
    if (!song) return;
    const store = useGameStore.getState();

    if (!store.paused && !w.finished) {
      w.songTime = now - w.startAt;

      // Advance the scan window past fully judged notes.
      while (w.scanFrom < w.notes.length && w.notes[w.scanFrom].judged) w.scanFrom += 1;

      // Auto-fail notes that drifted past the hit window.
      let missedSoundPlayed = false;
      for (let i = w.scanFrom; i < w.notes.length; i += 1) {
        const n = w.notes[i];
        if (n.time > w.songTime - HIT_WINDOW_MS) break;
        if (n.judged) continue;
        n.judged = true;
        n.rating = 'miss';
        trackPhrase(n, false);
        const comboBefore = store.combo;
        store.registerMiss(1);
        if (!missedSoundPlayed) {
          if (comboBefore >= 10) audio.comboBreak();
          else audio.playMiss();
          missedSoundPlayed = true;
        }
        w.lastMultiplier = 1;
        if (store.settings.screenShake) w.shake = 10;
        strikeBurst(n.lane, 'shatter');
        w.floats.push({
          text: 'MISS',
          color: MISS_COLOR,
          x: laneCenterX(w, n.lane, w.viewH * STRIKE_FRAC),
          y: w.viewH * STRIKE_FRAC - 40,
          life: 650,
          maxLife: 650,
        });
      }

      // Rock meter bottomed out — song failed.
      if (useGameStore.getState().rockMeter <= 0) {
        w.finished = true;
        store.finishGame(true, w.songTime / song.duration);
        return;
      }

      // Sustains: pay out while the fret is held.
      if (w.activeSustains.length > 0) {
        w.activeSustains = w.activeSustains.filter((track) => {
          if (!w.fretsHeld[track.lane]) return false;
          const until = Math.min(w.songTime, track.end);
          if (until > track.last) {
            w.sustainPending += ((until - track.last) / w.beatMs) * SUSTAIN_SCORE_PER_BEAT;
            track.last = until;
          }
          return w.songTime < track.end;
        });
        if (w.sustainPending >= 5) {
          const points = Math.floor(w.sustainPending);
          w.sustainPending -= points;
          store.addSustainScore(points);
        }
      }

      // Star power drain.
      if (w.spActive) {
        w.spGauge = Math.max(0, w.spGauge - dt / (SP_DRAIN_BEATS * w.beatMs));
        w.spSyncAcc += dt;
        if (w.spGauge <= 0) {
          w.spActive = false;
          store.setSpActive(false);
          store.setStarPower(0);
        } else if (w.spSyncAcc >= 150) {
          w.spSyncAcc = 0;
          store.setStarPower(w.spGauge);
        }
      }

      if (w.songTime > song.duration + 1200) {
        w.finished = true;
        if (w.sustainPending > 0) store.addSustainScore(Math.floor(w.sustainPending));
        const final = useGameStore.getState();
        if (final.notesMissed === 0 && final.overstrums === 0) audio.fullComboJingle();
        store.finishGame(false, 1);
        return;
      }
    }

    // Decay visual state even while paused so the overlay looks calm.
    for (let i = 0; i < 5; i += 1) w.laneFlash[i] = Math.max(0, w.laneFlash[i] - dt / 220);
    w.shake *= Math.exp(-dt / 90);
    if (w.shake < 0.15) w.shake = 0;
    w.particles.update(dt);
    for (const f of w.floats) {
      f.life -= dt;
      f.y -= dt * 0.06;
    }
    w.floats = w.floats.filter((f) => f.life > 0);
    for (const dot of w.ambient) {
      dot.y += (dot.vy * dt) / 1000 / w.viewH;
      if (dot.y > 1.05) dot.y = -0.05;
    }

    w.fpsAcc += dt;
    w.fpsFrames += 1;
    if (w.fpsAcc >= 500) {
      w.fps = Math.round((w.fpsFrames * 1000) / w.fpsAcc);
      w.fpsAcc = 0;
      w.fpsFrames = 0;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) render(ctx, w, song.duration, store.paused);
  };

  useGameLoop(step, Boolean(song));

  return (
    <div className="game-canvas-wrap">
      <canvas ref={canvasRef} />
    </div>
  );
}

// ===========================================================================
// Rendering — pure functions over the world state.
// ===========================================================================

function render(
  ctx: CanvasRenderingContext2D,
  w: WorldState,
  duration: number,
  paused: boolean,
): void {
  ctx.setTransform(w.dpr, 0, 0, w.dpr, 0, 0);
  ctx.clearRect(0, 0, w.viewW, w.viewH);

  ctx.save();
  if (w.shake > 0) {
    ctx.translate((Math.random() - 0.5) * w.shake, (Math.random() - 0.5) * w.shake);
  }

  drawBackground(ctx, w);
  drawBoard(ctx, w);
  drawBeatLines(ctx, w);
  drawSustainTails(ctx, w);
  drawGems(ctx, w);
  drawFretBar(ctx, w);
  drawLaneLabels(ctx, w);
  w.particles.draw(ctx);
  drawFloats(ctx, w);
  drawProgress(ctx, w, duration);
  drawCountdown(ctx, w);

  ctx.restore();

  if (paused) drawPausedOverlay(ctx, w);
  if (w.showFps) {
    ctx.fillStyle = w.fps >= 55 ? '#31d13c' : '#f28b1d';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${w.fps} fps`, 8, w.viewH - 10);
  }
}

function drawBackground(ctx: CanvasRenderingContext2D, w: WorldState): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, w.viewH);
  gradient.addColorStop(0, '#0d0910');
  gradient.addColorStop(0.6, '#100a16');
  gradient.addColorStop(1, '#160b1c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w.viewW, w.viewH);

  // Faint stage haze + floating dust in the venue lights.
  ctx.save();
  ctx.fillStyle = '#b092ff';
  for (const dot of w.ambient) {
    ctx.globalAlpha = dot.a * 0.4;
    ctx.beginPath();
    ctx.arc(dot.x * w.viewW, dot.y * w.viewH, dot.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBoard(ctx: CanvasRenderingContext2D, w: WorldState): void {
  const topY = w.viewH * HORIZON_FRAC;
  const top = laneGeometry(w, topY);
  const bottom = laneGeometry(w, w.viewH);

  // Dark fretboard bed.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(top.left, topY);
  ctx.lineTo(top.left + top.laneW * 5, topY);
  ctx.lineTo(bottom.left + bottom.laneW * 5, w.viewH);
  ctx.lineTo(bottom.left, w.viewH);
  ctx.closePath();
  const bed = ctx.createLinearGradient(0, topY, 0, w.viewH);
  bed.addColorStop(0, 'rgba(18, 18, 24, 0.92)');
  bed.addColorStop(1, 'rgba(28, 28, 36, 0.95)');
  ctx.fillStyle = bed;
  ctx.fill();

  // Star power turns the whole board electric blue.
  if (w.spActive) {
    ctx.fillStyle = 'rgba(60, 140, 255, 0.13)';
    ctx.fill();
  }

  // Pressed-lane glow.
  for (let lane = 0; lane < 5; lane += 1) {
    const flash = w.laneFlash[lane];
    if (flash <= 0 && !w.fretsHeld[lane]) continue;
    ctx.beginPath();
    ctx.moveTo(top.left + top.laneW * lane, topY);
    ctx.lineTo(top.left + top.laneW * (lane + 1), topY);
    ctx.lineTo(bottom.left + bottom.laneW * (lane + 1), w.viewH);
    ctx.lineTo(bottom.left + bottom.laneW * lane, w.viewH);
    ctx.closePath();
    const alpha = Math.min(0.28, Math.max(w.fretsHeld[lane] ? 0.08 : 0, flash * 0.22));
    ctx.fillStyle = `${LANE_COLORS[lane]}${Math.round(alpha * 255)
      .toString(16)
      .padStart(2, '0')}`;
    ctx.fill();
  }

  // Lane strings + edge rails.
  ctx.lineWidth = 1.2;
  for (let i = 0; i <= 5; i += 1) {
    const rail = i === 0 || i === 5;
    ctx.strokeStyle = rail ? 'rgba(220, 220, 235, 0.75)' : 'rgba(150, 150, 170, 0.28)';
    ctx.shadowColor = rail ? '#cfd4ff' : 'transparent';
    ctx.shadowBlur = rail ? 8 : 0;
    ctx.lineWidth = rail ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(top.left + top.laneW * i, topY);
    ctx.lineTo(bottom.left + bottom.laneW * i, w.viewH);
    ctx.stroke();
  }
  ctx.restore();
}

/** Horizontal beat lines scrolling down the board; measures are brighter. */
function drawBeatLines(ctx: CanvasRenderingContext2D, w: WorldState): void {
  const approach = approachMs();
  const firstBeat = Math.max(0, Math.floor(w.songTime / w.beatMs));
  ctx.save();
  for (let k = firstBeat; ; k += 1) {
    const beatTime = k * w.beatMs;
    if (beatTime > w.songTime + approach) break;
    const p = 1 - (beatTime - w.songTime) / approach;
    if (p < 0 || p > 1) continue;
    const y = yForProgress(w, p);
    const { left, laneW } = laneGeometry(w, y);
    const measure = k % 4 === 0;
    ctx.strokeStyle = measure ? 'rgba(220, 220, 240, 0.3)' : 'rgba(160, 160, 185, 0.12)';
    ctx.lineWidth = measure ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + laneW * 5, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSustainTails(ctx: CanvasRenderingContext2D, w: WorldState): void {
  const approach = approachMs();
  const strikeY = w.viewH * STRIKE_FRAC;
  ctx.save();
  ctx.lineCap = 'round';

  const drawTail = (lane: Lane, fromY: number, toY: number, bright: boolean): void => {
    const midY = (fromY + toY) / 2;
    const { laneW } = laneGeometry(w, midY);
    ctx.strokeStyle = LANE_COLORS[lane];
    ctx.globalAlpha = bright ? 0.95 : 0.55;
    ctx.lineWidth = Math.max(4, laneW * (bright ? 0.22 : 0.16));
    ctx.shadowColor = LANE_COLORS[lane];
    ctx.shadowBlur = bright ? 14 : 6;
    ctx.beginPath();
    ctx.moveTo(laneCenterX(w, lane, fromY), fromY);
    ctx.lineTo(laneCenterX(w, lane, toY), toY);
    ctx.stroke();
  };

  // Unhit notes with tails.
  for (let i = w.scanFrom; i < w.notes.length; i += 1) {
    const n = w.notes[i];
    if (n.judged || n.duration === 0) continue;
    const pHead = 1 - (n.time - w.songTime) / approach;
    if (pHead < 0) break;
    const pEnd = 1 - (n.time + n.duration - w.songTime) / approach;
    if (pHead > 1.3) continue;
    drawTail(n.lane, yForProgress(w, Math.min(pHead, 1.05)), yForProgress(w, Math.max(pEnd, 0)), false);
  }

  // Actively held sustains: tail burns bright from the fret bar upward.
  for (const track of w.activeSustains) {
    const pEnd = 1 - (track.end - w.songTime) / approach;
    drawTail(track.lane, strikeY, yForProgress(w, Math.max(pEnd, 0)), true);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawGems(ctx: CanvasRenderingContext2D, w: WorldState): void {
  const approach = approachMs();
  for (let i = w.scanFrom; i < w.notes.length; i += 1) {
    const n = w.notes[i];
    if (n.judged) continue;
    const p = 1 - (n.time - w.songTime) / approach;
    if (p < 0) break; // sorted: everything further is above the horizon
    if (p > 1.3) continue;
    const y = yForProgress(w, p);
    const x = laneCenterX(w, n.lane, y);
    const { laneW } = laneGeometry(w, y);
    drawGem(ctx, x, y, laneW * 0.3, n, w.spActive);
  }
}

/** GH2-style gem: glossy colored disc; HOPOs get a white core, SP gems a star. */
function drawGem(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  note: Note,
  spActive: boolean,
): void {
  const color = LANE_COLORS[note.lane];
  ctx.save();

  // Dark bezel.
  ctx.beginPath();
  ctx.ellipse(x, y, radius, radius * 0.72, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#101014';
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Colored face (white face for HOPO gems).
  const face = radius * 0.78;
  const gradient = ctx.createRadialGradient(x, y - face * 0.4, face * 0.1, x, y, face);
  if (note.hopo) {
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.7, '#e8e8f2');
    gradient.addColorStop(1, color);
  } else {
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.25, color);
    gradient.addColorStop(1, color);
  }
  ctx.beginPath();
  ctx.ellipse(x, y, face, face * 0.72, 0, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Star-power phrase gems carry a star glint (blue-white when SP is lit).
  if (note.starPhrase !== null) {
    ctx.fillStyle = spActive ? '#9fd0ff' : '#ffffff';
    ctx.beginPath();
    const r1 = face * 0.55;
    const r2 = face * 0.22;
    for (let k = 0; k < 8; k += 1) {
      const r = k % 2 === 0 ? r1 : r2;
      const a = (Math.PI / 4) * k - Math.PI / 2;
      const px = x + r * Math.cos(a);
      const py = y + r * 0.72 * Math.sin(a);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** The fret bar: a dark strip with five clickable-looking fret buttons. */
function drawFretBar(ctx: CanvasRenderingContext2D, w: WorldState): void {
  const y = w.viewH * STRIKE_FRAC;
  const { left, laneW } = laneGeometry(w, y);
  const right = left + laneW * 5;

  ctx.save();
  // Strip.
  ctx.fillStyle = 'rgba(8, 8, 12, 0.75)';
  ctx.fillRect(left, y - 16, right - left, 32);
  ctx.strokeStyle = 'rgba(220, 220, 240, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(left, y - 16, right - left, 32);

  // Fret buttons.
  for (let lane = 0; lane < 5; lane += 1) {
    const x = laneCenterX(w, lane, y);
    const held = w.fretsHeld[lane];
    const flash = w.laneFlash[lane];
    const press = held ? 2 : 0;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y + press, laneW * 0.3, laneW * 0.21, 0, 0, Math.PI * 2);
    if (held) {
      ctx.fillStyle = LANE_COLORS[lane];
      ctx.shadowColor = LANE_COLORS[lane];
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(x, y + press - laneW * 0.06, laneW * 0.18, laneW * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#15151b';
      ctx.fill();
      ctx.strokeStyle = LANE_COLORS[lane];
      ctx.lineWidth = 2.5;
      ctx.shadowColor = LANE_COLORS[lane];
      ctx.shadowBlur = flash > 0 ? 16 : 6;
      ctx.stroke();
    }
    if (flash > 0) {
      ctx.globalAlpha = flash * 0.4;
      ctx.fillStyle = LANE_COLORS[lane];
      ctx.beginPath();
      ctx.ellipse(x, y + press, laneW * 0.34, laneW * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawLaneLabels(ctx: CanvasRenderingContext2D, w: WorldState): void {
  const { keyBindings } = useGameStore.getState().settings;
  const y = w.viewH * STRIKE_FRAC + 44;
  ctx.save();
  ctx.font = 'bold 15px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  for (let lane = 0; lane < 5; lane += 1) {
    const x = laneCenterX(w, lane, w.viewH * STRIKE_FRAC);
    ctx.fillStyle = w.fretsHeld[lane] ? '#ffffff' : 'rgba(255,255,255,0.5)';
    ctx.fillText(keyLabel(keyBindings[lane]), x, y);
  }
  ctx.restore();
}

function drawFloats(ctx: CanvasRenderingContext2D, w: WorldState): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px "Segoe UI", sans-serif';
  for (const f of w.floats) {
    ctx.globalAlpha = f.life / f.maxLife;
    ctx.fillStyle = f.color;
    ctx.shadowColor = f.color;
    ctx.shadowBlur = 12;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawProgress(ctx: CanvasRenderingContext2D, w: WorldState, duration: number): void {
  const progress = Math.min(1, Math.max(0, w.songTime / duration));
  const y = w.viewH - 6;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(0, y, w.viewW, 4);
  const gradient = ctx.createLinearGradient(0, 0, w.viewW, 0);
  gradient.addColorStop(0, '#f28b1d');
  gradient.addColorStop(1, '#e33529');
  ctx.fillStyle = gradient;
  ctx.shadowColor = '#f28b1d';
  ctx.shadowBlur = 8;
  ctx.fillRect(0, y, w.viewW * progress, 4);
  ctx.restore();
}

function drawCountdown(ctx: CanvasRenderingContext2D, w: WorldState): void {
  if (w.songTime >= 2800 || w.songTime < 0) return;
  const remaining = 3000 - w.songTime;
  const count = Math.ceil(remaining / 1000);
  const frac = (remaining % 1000) / 1000;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.25 + 0.75 * frac;
  ctx.fillStyle = '#f28b1d';
  ctx.shadowColor = '#f28b1d';
  ctx.shadowBlur = 30;
  ctx.font = `bold ${60 + 30 * frac}px "Segoe UI", sans-serif`;
  ctx.fillText(String(count), w.viewW / 2, w.viewH * 0.4);
  ctx.font = 'bold 20px "Segoe UI", sans-serif';
  ctx.fillText('GET READY', w.viewW / 2, w.viewH * 0.4 + 46);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawPausedOverlay(ctx: CanvasRenderingContext2D, w: WorldState): void {
  ctx.save();
  ctx.fillStyle = 'rgba(4, 2, 12, 0.72)';
  ctx.fillRect(0, 0, w.viewW, w.viewH);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f28b1d';
  ctx.shadowColor = '#f28b1d';
  ctx.shadowBlur = 24;
  ctx.font = 'bold 52px "Segoe UI", sans-serif';
  ctx.fillText('PAUSED', w.viewW / 2, w.viewH * 0.42);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '18px "Segoe UI", sans-serif';
  ctx.fillText('ESC resume · R restart · Q quit to menu', w.viewW / 2, w.viewH * 0.42 + 48);
  ctx.restore();
}
