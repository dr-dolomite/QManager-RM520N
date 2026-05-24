// ─── Signal Storm — GameAudio module ──────────────────────────────────────────
// Self-contained audio for the easter-egg shmup.  Uses Web Audio API only.
// Lazy AudioContext creation (requires a user gesture before playback).

const LS_MUTE_KEY = "qm_game_muted";

// ─── Note frequency lookup ───────────────────────────────────────────────────

const NOTE_FREQ: Record<string, number> = {
  C2: 65.41,  D2: 73.42,  E2: 82.41,  F2: 87.31,  G2: 98.0,   A2: 110.0,  B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0,  A3: 220.0,  B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0,  A4: 440.0,  B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0,  B5: 987.77,
  C6: 1046.5,
};

// ─── Track definitions ───────────────────────────────────────────────────────

const NORMAL_LEAD = [
  "A3","C4","E4","A4","G4","E4","C4","A3",
  "F3","A3","C4","F4","E4","C4","A3","F3",
  "A3","D4","F4","A4","G4","F4","D4","A3",
  "E3","G3","B3","E4","D4","B3","G3","E3",
];

const NORMAL_BASS = [
  "A2","A2","F2","F2","D2","D2","E2","E2",
  "A2","A2","F2","F2","D2","D2","E2","E2",
];

const BOSS_LEAD = [
  "A3","E4","A4","E4","A3","E4","A4","E4",
  "F3","C4","F4","C4","F3","C4","F4","C4",
  "D3","A3","D4","A3","D3","A3","D4","A3",
  "E3","B3","E4","B3","E3","B3","E4","B3",
];

const BOSS_BASS = [
  "A2","A2","A2","A2","F2","F2","F2","F2",
  "D2","D2","D2","D2","E2","E2","E2","E2",
];

const STEP_MS = 150;
const NOTE_DUR = 0.14; // seconds, 10ms gap for articulation
const MUSIC_GAIN = 0.3;
const SFX_GAIN = 0.7;
const MASTER_GAIN = 1.0;
const FADE_MS = 200;

// ─── Noise buffer (reused for explosion) ────────────────────────────────────

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, 2048, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < 2048; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buf;
}

// ─── GameAudio class ─────────────────────────────────────────────────────────

export class GameAudio {
  private actx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  private muted: boolean;
  private audioInitialized = false;

  // Music state
  private musicMode: "normal" | "boss" | null = null;
  private musicInterval: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;
  private noiseBuffer: AudioBuffer | null = null;

  constructor() {
    try {
      this.muted = localStorage.getItem(LS_MUTE_KEY) === "true";
    } catch {
      this.muted = false;
    }
  }

  // ── Lazy init ──────────────────────────────────────────────────────────────

  ensureContext(): void {
    if (this.audioInitialized) return;
    this.audioInitialized = true;

    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextCtor) return;

      this.actx = new AudioContextCtor();

      // Master gain
      this.masterGain = this.actx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : MASTER_GAIN;
      this.masterGain.connect(this.actx.destination);

      // SFX gain → master
      this.sfxGain = this.actx.createGain();
      this.sfxGain.gain.value = SFX_GAIN;
      this.sfxGain.connect(this.masterGain);

      // Music gain → master
      this.musicGain = this.actx.createGain();
      this.musicGain.gain.value = MUSIC_GAIN;
      this.musicGain.connect(this.masterGain);

      // Pre-build noise buffer for explosions
      this.noiseBuffer = makeNoiseBuffer(this.actx);
    } catch {
      // AudioContext unavailable
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private get ctx(): AudioContext | null {
    return this.actx;
  }

  /** Create a simple oscillator SFX that plays once. */
  private playOsc(
    type: OscillatorType,
    freqStart: number,
    freqEnd: number,
    durationMs: number,
    attackMs = 5,
    destination?: AudioNode,
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const dur = durationMs / 1000;
    const attack = attackMs / 1000;

    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.linearRampToValueAtTime(freqEnd, now + dur);

    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(1, now + attack);
    env.gain.linearRampToValueAtTime(0, now + dur);

    osc.connect(env);
    env.connect(destination ?? this.sfxGain);

    osc.start(now);
    osc.stop(now + dur);
  }

  // ── SFX ───────────────────────────────────────────────────────────────────

  playShoot(): void {
    if (this.muted || !this.ctx) return;
    this.playOsc("square", 880, 440, 80);
  }

  playHit(): void {
    if (this.muted || !this.ctx) return;
    this.playOsc("square", 220, 220, 50);
  }

  playExplode(): void {
    if (this.muted || !this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const dur = 0.2;

    // Sawtooth sweep
    this.playOsc("sawtooth", 110, 55, 200);

    // Noise burst
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(1, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(env);
    env.connect(this.sfxGain);

    src.start(now);
    src.stop(now + dur);
  }

  playBossHit(): void {
    if (this.muted || !this.ctx) return;
    this.playOsc("square", 330, 330, 60);
  }

  playPowerUp(): void {
    if (this.muted || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const freqs = [523, 784, 1047]; // C5, G5, C6
    const noteDur = 0.066;
    for (let i = 0; i < freqs.length; i++) {
      const t = now + i * noteDur;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freqs[i], t);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.005);
      env.gain.linearRampToValueAtTime(0, t + noteDur);
      osc.connect(env);
      env.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + noteDur);
    }
  }

  playShieldBreak(): void {
    if (this.muted || !this.ctx) return;
    this.playOsc("sawtooth", 660, 220, 150);
  }

  playPhaseTransition(): void {
    if (this.muted || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    // First tone: 440 Hz for 100ms
    const osc1 = this.ctx.createOscillator();
    const env1 = this.ctx.createGain();
    osc1.type = "square";
    osc1.frequency.setValueAtTime(440, now);
    env1.gain.setValueAtTime(0, now);
    env1.gain.linearRampToValueAtTime(1, now + 0.005);
    env1.gain.linearRampToValueAtTime(0, now + 0.1);
    osc1.connect(env1);
    env1.connect(this.sfxGain);
    osc1.start(now);
    osc1.stop(now + 0.1);

    // 50ms gap, then 880 Hz for 100ms
    const t2 = now + 0.15;
    const osc2 = this.ctx.createOscillator();
    const env2 = this.ctx.createGain();
    osc2.type = "square";
    osc2.frequency.setValueAtTime(880, t2);
    env2.gain.setValueAtTime(0, t2);
    env2.gain.linearRampToValueAtTime(1, t2 + 0.005);
    env2.gain.linearRampToValueAtTime(0, t2 + 0.1);
    osc2.connect(env2);
    env2.connect(this.sfxGain);
    osc2.start(t2);
    osc2.stop(t2 + 0.1);
  }

  playPlayerHit(): void {
    if (this.muted || !this.ctx) return;
    this.playOsc("sawtooth", 220, 55, 400);
  }

  playBossIntro(): void {
    if (this.muted || !this.ctx) return;
    this.playOsc("square", 220, 220, 250, 20);
  }

  // ── Music ─────────────────────────────────────────────────────────────────

  startMusic(mode: "normal" | "boss"): void {
    if (!this.ctx || !this.musicGain) return;
    if (this.musicMode === mode) return; // already playing this track

    const isFirstStart = this.musicMode === null && this.musicInterval === null;

    if (isFirstStart) {
      this.musicMode = mode;
      this.musicStep = 0;
      this._startMusicInterval(mode);
      return;
    }

    // Crossfade: fade out → swap → fade in
    this._fadeMusicGain(0, FADE_MS, () => {
      this._clearMusicInterval();
      this.musicMode = mode;
      this.musicStep = 0;
      this._startMusicInterval(mode);
      this._fadeMusicGain(MUSIC_GAIN, FADE_MS);
    });
  }

  stopMusic(): void {
    this._fadeMusicGain(0, FADE_MS, () => {
      this._clearMusicInterval();
      this.musicMode = null;
      this.musicStep = 0;
    });
  }

  private _startMusicInterval(mode: "normal" | "boss"): void {
    const lead = mode === "normal" ? NORMAL_LEAD : BOSS_LEAD;
    const bass = mode === "normal" ? NORMAL_BASS : BOSS_BASS;

    this.musicInterval = setInterval(() => {
      if (!this.ctx || !this.musicGain) return;
      const step = this.musicStep;

      // Lead note every step
      const leadNote = lead[step % lead.length];
      this._playMusicNote("square", leadNote);

      // Bass at half tempo (every other step)
      if (step % 2 === 0) {
        const bassNote = bass[Math.floor(step / 2) % bass.length];
        this._playMusicNote("triangle", bassNote);
      }

      this.musicStep++;
    }, STEP_MS);
  }

  private _playMusicNote(type: OscillatorType, note: string): void {
    if (!this.ctx || !this.musicGain) return;
    const freq = NOTE_FREQ[note];
    if (!freq) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    env.gain.setValueAtTime(0.6, now);
    env.gain.linearRampToValueAtTime(0, now + NOTE_DUR);
    osc.connect(env);
    env.connect(this.musicGain);
    osc.start(now);
    osc.stop(now + NOTE_DUR);
  }

  private _fadeMusicGain(
    target: number,
    durationMs: number,
    onDone?: () => void,
  ): void {
    if (!this.ctx || !this.musicGain) {
      onDone?.();
      return;
    }
    const now = this.ctx.currentTime;
    const dur = durationMs / 1000;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
    this.musicGain.gain.linearRampToValueAtTime(target, now + dur);
    if (onDone) {
      setTimeout(onDone, durationMs);
    }
  }

  private _clearMusicInterval(): void {
    if (this.musicInterval !== null) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
  }

  // ── Pause / Resume (separate from user-facing mute) ────────────────────────

  pauseAudio(): void {
    if (!this.actx || !this.masterGain || this.muted) return;
    const now = this.actx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(0, now + 0.1);
  }

  resumeAudio(): void {
    if (!this.actx || !this.masterGain || this.muted) return;
    const now = this.actx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(MASTER_GAIN, now + 0.1);
  }

  // ── Mute ──────────────────────────────────────────────────────────────────

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(LS_MUTE_KEY, String(this.muted));
    } catch {
      // ignore
    }
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : MASTER_GAIN;
    }
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  dispose(): void {
    this._clearMusicInterval();
    try {
      this.actx?.close();
    } catch {
      // ignore
    }
    this.actx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.audioInitialized = false;
  }
}
