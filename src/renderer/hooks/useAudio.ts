import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';

// ---------------------------------------------------------------------------
// Web Audio synthesis — rock/metal edition. Everything is generated: no
// samples, no network. Hit sounds are distorted power chords (sawtooth
// root + fifth + octave driven through a tanh waveshaper), one E-minor
// pentatonic root per lane (E3 G3 A3 B3 D4), lane 0 = low string. Backing is
// a low-E drone plus a kick/snare rock beat — double kick on fast songs.
// ---------------------------------------------------------------------------

const LANE_FREQ = [164.81, 196.0, 220.0, 246.94, 293.66];

interface ToneOptions {
  freq: number;
  type?: OscillatorType;
  duration?: number;
  gain?: number;
  when?: number;
  detune?: number;
  freqEnd?: number;
  filterFreq?: number;
}

interface ChordOptions {
  freq: number;
  gain: number;
  duration: number;
  filterFreq: number;
  detune?: number;
  when?: number;
}

class AudioEngine {
  private ctx: AudioContext | null = null;

  private masterBus: GainNode | null = null;

  private sfxBus: GainNode | null = null;

  private musicBus: GainNode | null = null;

  /** Imported-song playback: full music volume, unlike the quiet synth bed. */
  private trackBus: GainNode | null = null;

  private trackSource: AudioBufferSourceNode | null = null;

  private volumes = { master: 0.8, sfx: 0.9, music: 0.5 };

  private muted = false;

  private padNodes: AudioNode[] = [];

  private beatTimer: number | null = null;

  private nextTickAt = 0;

  private tickIndex = 0;

  private available = true;

  private static distortionCurve: Float32Array<ArrayBuffer> | null = null;

  private noiseBuffer: AudioBuffer | null = null;

  /** Lazily create the AudioContext; degrade to silence if unsupported. */
  private ensure(): AudioContext | null {
    if (!this.available) return null;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    try {
      this.ctx = new AudioContext();
      this.masterBus = this.ctx.createGain();
      this.masterBus.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.masterBus);
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(this.masterBus);
      this.trackBus = this.ctx.createGain();
      this.trackBus.connect(this.masterBus);
      this.applyVolumes();
      return this.ctx;
    } catch (err) {
      console.warn('Web Audio unavailable — running silent', err);
      this.available = false;
      return null;
    }
  }

  private applyVolumes(): void {
    if (!this.masterBus || !this.sfxBus || !this.musicBus) return;
    this.masterBus.gain.value = this.muted ? 0 : this.volumes.master;
    this.sfxBus.gain.value = this.volumes.sfx;
    // Music sits well under the SFX (roughly -20 dB territory).
    this.musicBus.gain.value = this.volumes.music * 0.3;
    if (this.trackBus) this.trackBus.gain.value = this.volumes.music;
  }

  setVolumes(master: number, sfx: number, music: number): void {
    this.volumes = { master, sfx, music };
    this.applyVolumes();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
  }

  /** Suspend all sound (used while paused). */
  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  /** Soft-clipping waveshaper — the "amp" every guitar sound goes through. */
  private makeDistortion(ctx: AudioContext): WaveShaperNode {
    if (!AudioEngine.distortionCurve) {
      const samples = 1024;
      const curve = new Float32Array(samples);
      const drive = 30;
      for (let i = 0; i < samples; i += 1) {
        const x = (i / (samples - 1)) * 2 - 1;
        curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
      }
      AudioEngine.distortionCurve = curve;
    }
    const shaper = ctx.createWaveShaper();
    shaper.curve = AudioEngine.distortionCurve;
    shaper.oversample = '2x';
    return shaper;
  }

  private getNoise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const length = Math.floor(ctx.sampleRate * 0.2);
      this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuffer;
  }

  private tone(opts: ToneOptions, bus?: GainNode | null): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const target = bus ?? this.sfxBus;
    if (!target) return;
    const start = ctx.currentTime + (opts.when ?? 0);
    const duration = opts.duration ?? 0.18;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, start);
    if (opts.freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), start + duration);
    }
    if (opts.detune) osc.detune.value = opts.detune;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(opts.gain ?? 0.25, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    if (opts.filterFreq) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = opts.filterFreq;
      osc.connect(filter);
      filter.connect(gain);
    } else {
      osc.connect(gain);
    }
    gain.connect(target);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  /** Distorted power chord: root + fifth + octave saws through the "amp". */
  private powerChord(opts: ChordOptions): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus) return;
    const start = ctx.currentTime + (opts.when ?? 0);
    const shaper = this.makeDistortion(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = opts.filterFreq;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, start);
    out.gain.exponentialRampToValueAtTime(opts.gain, start + 0.006);
    out.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);
    shaper.connect(filter);
    filter.connect(out);
    out.connect(this.sfxBus);

    const partials: Array<[number, number]> = [
      [1, 0.8],
      [1.5, 0.55],
      [2, 0.3],
    ];
    for (const [ratio, level] of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = opts.freq * ratio;
      if (opts.detune) osc.detune.value = opts.detune * (ratio === 1 ? 1 : -1);
      const oscGain = ctx.createGain();
      oscGain.gain.value = level;
      osc.connect(oscGain);
      oscGain.connect(shaper);
      osc.start(start);
      osc.stop(start + opts.duration + 0.05);
    }
  }

  /** GH2-style: one hit sound; sustains let the chord ring out longer. */
  playHit(lane: number, sustainSec = 0): void {
    const freq = LANE_FREQ[lane] ?? LANE_FREQ[2];
    const duration = 0.3 + Math.min(sustainSec, 1.5) * 0.8;
    this.powerChord({ freq, gain: 0.3, duration, filterFreq: 2400 });
  }

  /** Overstrum: dead muted clunk, like strumming with nothing fretted. */
  overstrum(): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus) return;
    const start = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.getNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start(start);
    src.stop(start + 0.12);
    this.tone({ freq: 72, freqEnd: 55, type: 'sine', gain: 0.2, duration: 0.08 });
  }

  /** Star power activation: rising electric sweep. */
  starPowerOn(): void {
    this.tone({
      freq: 220,
      freqEnd: 880,
      type: 'sawtooth',
      gain: 0.18,
      duration: 0.45,
      filterFreq: 2200,
    });
    this.tone({ freq: 440, freqEnd: 1760, type: 'sine', gain: 0.12, duration: 0.45, when: 0.05 });
  }

  playMiss(): void {
    // Low bass thud with a pitch drop — dropped-tuning string flub.
    this.tone({ freq: 85, freqEnd: 38, type: 'sine', gain: 0.45, duration: 0.28 });
  }

  comboUp(): void {
    // Rising run when the multiplier tier climbs.
    [196.0, 246.94, 329.63].forEach((freq, i) => {
      this.tone({ freq, type: 'triangle', gain: 0.16, duration: 0.12, when: i * 0.07 });
    });
  }

  comboBreak(): void {
    this.tone({ freq: 300, freqEnd: 180, type: 'sawtooth', gain: 0.12, duration: 0.2 });
    this.tone({ freq: 200, freqEnd: 110, type: 'sawtooth', gain: 0.12, duration: 0.25, when: 0.1 });
  }

  fullComboJingle(): void {
    // Victory run up the E-minor pentatonic.
    [329.63, 392.0, 493.88, 587.33, 659.25].forEach((freq, i) => {
      this.tone({ freq, type: 'triangle', gain: 0.2, duration: 0.22, when: i * 0.11 });
    });
  }

  uiClick(): void {
    this.tone({ freq: 700, type: 'sine', gain: 0.08, duration: 0.06 });
  }

  private kick(when: number, gain = 0.55): void {
    this.tone({ freq: 125, freqEnd: 42, type: 'sine', gain, duration: 0.12, when }, this.musicBus);
  }

  private snare(when: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const start = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.getNoise(ctx);
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1800;
    bandpass.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
    src.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(this.musicBus);
    src.start(start);
    src.stop(start + 0.15);
  }

  /**
   * Backing track: low-E power-chord drone through the amp, plus a rock beat
   * (kick on 1 & 3, snare on 2 & 4). Songs at 160+ BPM get double kick on the
   * offbeats — thrash needs it.
   */
  startMusic(bpm: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    this.stopMusic();

    const shaper = this.makeDistortion(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.09;
    shaper.connect(filter);
    filter.connect(droneGain);
    droneGain.connect(this.musicBus);
    [82.41, 123.47].forEach((freq) => {
      // E2 + B2: the classic low power chord
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = (Math.random() - 0.5) * 8;
      osc.connect(shaper);
      osc.start();
      this.padNodes.push(osc);
    });
    this.padNodes.push(shaper, filter, droneGain);

    // Drum scheduler: half-beat ticks, scheduled slightly ahead so timer
    // jitter is inaudible.
    const halfBeat = 30 / bpm;
    const doubleKick = bpm >= 160;
    this.nextTickAt = ctx.currentTime + 0.1;
    this.tickIndex = 0;
    const schedule = (): void => {
      if (!this.ctx) return;
      while (this.nextTickAt < this.ctx.currentTime + 0.35) {
        const when = this.nextTickAt - this.ctx.currentTime;
        const offbeat = this.tickIndex % 2 === 1;
        const beatInBar = Math.floor(this.tickIndex / 2) % 4;
        if (!offbeat) {
          if (beatInBar % 2 === 0) this.kick(when);
          else this.snare(when);
        } else if (doubleKick) {
          this.kick(when, 0.35);
        }
        this.nextTickAt += halfBeat;
        this.tickIndex += 1;
      }
    };
    schedule();
    this.beatTimer = window.setInterval(schedule, 120);
  }

  /** Play an imported song's audio, delayed to line up with the countdown. */
  startTrack(buffer: AudioBuffer, delayMs: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.trackBus) return;
    this.stopTrack();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.trackBus);
    source.start(ctx.currentTime + delayMs / 1000);
    this.trackSource = source;
  }

  stopTrack(): void {
    if (!this.trackSource) return;
    try {
      this.trackSource.stop();
      this.trackSource.disconnect();
    } catch {
      /* already stopped */
    }
    this.trackSource = null;
  }

  stopMusic(): void {
    if (this.beatTimer !== null) {
      window.clearInterval(this.beatTimer);
      this.beatTimer = null;
    }
    for (const node of this.padNodes) {
      try {
        if (node instanceof OscillatorNode) node.stop();
        node.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.padNodes = [];
  }
}

/** Singleton — canvas code imports this directly, outside React. */
export const audio = new AudioEngine();

/** Keeps the engine's volume/mute state in sync with the settings store. */
export function useAudio(): AudioEngine {
  const masterVolume = useGameStore((s) => s.settings.masterVolume);
  const sfxVolume = useGameStore((s) => s.settings.sfxVolume);
  const musicVolume = useGameStore((s) => s.settings.musicVolume);
  const muted = useGameStore((s) => s.muted);

  useEffect(() => {
    audio.setVolumes(masterVolume, sfxVolume, musicVolume);
  }, [masterVolume, sfxVolume, musicVolume]);

  useEffect(() => {
    audio.setMuted(muted);
  }, [muted]);

  return audio;
}
