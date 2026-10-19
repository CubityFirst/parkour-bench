/**
 * AudioManager - all sound is synthesised with the Web Audio API (no audio files).
 *
 * One-shot effects (footstep, jump, landing, vault, checkpoint, finish...) are built from
 * short noise bursts and oscillators; continuous layers (wind, slide scrape, wall-run
 * scrape) are looping filtered noise whose gain / frequency follow the player's state.
 * The AudioContext is created lazily on the first user gesture.
 */

export interface AudioState {
  speed: number;
  grounded: boolean;
  sliding: boolean;
  wallRunning: boolean;
  /** Hold everything quiet (menu / paused). */
  active: boolean;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private windSrc: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  private slideGain: GainNode | null = null;
  private slideFilter: BiquadFilterNode | null = null;
  private wallGain: GainNode | null = null;

  private volume = 0.7;
  private lastStep = 0;

  /** Must be called from a user gesture (click / key). Safe to call repeatedly. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // 2 seconds of white noise, reused by every noise based sound.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startLoops();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    }
  }

  private startLoops(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;

    // ---- wind
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = this.noise;
    this.windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.windSrc.start();

    // ---- slide scrape
    const slideSrc = ctx.createBufferSource();
    slideSrc.buffer = this.noise;
    slideSrc.loop = true;
    slideSrc.playbackRate.value = 0.8;
    this.slideFilter = ctx.createBiquadFilter();
    this.slideFilter.type = 'bandpass';
    this.slideFilter.frequency.value = 900;
    this.slideFilter.Q.value = 0.9;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    slideSrc.connect(this.slideFilter).connect(this.slideGain).connect(this.master);
    slideSrc.start();

    // ---- wall-run scrape (higher, thinner)
    const wallSrc = ctx.createBufferSource();
    wallSrc.buffer = this.noise;
    wallSrc.loop = true;
    wallSrc.playbackRate.value = 1.3;
    const wallFilter = ctx.createBiquadFilter();
    wallFilter.type = 'bandpass';
    wallFilter.frequency.value = 2200;
    wallFilter.Q.value = 1.2;
    this.wallGain = ctx.createGain();
    this.wallGain.gain.value = 0;
    wallSrc.connect(wallFilter).connect(this.wallGain).connect(this.master);
    wallSrc.start();
  }

  /** Per-frame update of the continuous layers. */
  update(s: AudioState): void {
    const ctx = this.ctx;
    if (!ctx || !this.windGain || !this.windFilter || !this.slideGain || !this.slideFilter || !this.wallGain) return;
    const t = ctx.currentTime;
    const on = s.active ? 1 : 0;

    const windT = Math.max(0, Math.min(1, (s.speed - 3.5) / 8));
    const windAmt = Math.pow(windT, 1.4) * (s.grounded ? 0.16 : 0.26) * on;
    this.windGain.gain.setTargetAtTime(windAmt, t, 0.12);
    this.windFilter.frequency.setTargetAtTime(380 + s.speed * 70, t, 0.15);

    const slideAmt = s.sliding ? Math.min(1, s.speed / 9) * 0.26 * on : 0;
    this.slideGain.gain.setTargetAtTime(slideAmt, t, 0.05);
    this.slideFilter.frequency.setTargetAtTime(600 + s.speed * 70, t, 0.1);

    this.wallGain.gain.setTargetAtTime(s.wallRunning ? 0.07 * on : 0, t, 0.06);
  }

  // ------------------------------------------------------------------ one shots

  private burst(opts: {
    type?: BiquadFilterType; freq: number; freqEnd?: number; q?: number;
    gain: number; attack?: number; decay: number; delay?: number; rate?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = opts.rate ?? 1;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'lowpass';
    f.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + opts.decay);
    f.Q.value = opts.q ?? 0.7;
    const g = ctx.createGain();
    const atk = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + opts.decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + atk + opts.decay + 0.05);
  }

  private tone(opts: {
    type?: OscillatorType; freq: number; freqEnd?: number; gain: number;
    attack?: number; decay: number; delay?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + opts.decay);
    const g = ctx.createGain();
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + opts.decay);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + atk + opts.decay + 0.05);
  }

  footstep(sprinting: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastStep < 0.05) return;
    this.lastStep = now;
    const v = 0.85 + Math.random() * 0.3;
    this.burst({ freq: (sprinting ? 1500 : 1100) * v, freqEnd: 400, gain: sprinting ? 0.17 : 0.11, decay: 0.07, q: 0.8, rate: v });
    this.tone({ freq: 110 * v, freqEnd: 52, gain: sprinting ? 0.2 : 0.13, decay: 0.07 });
  }

  jump(): void {
    this.burst({ type: 'bandpass', freq: 500, freqEnd: 1500, q: 0.9, gain: 0.14, decay: 0.16, attack: 0.02 });
    this.tone({ freq: 130, freqEnd: 70, gain: 0.16, decay: 0.09 });
  }

  wallJump(): void {
    this.burst({ type: 'bandpass', freq: 900, freqEnd: 2200, q: 1.1, gain: 0.16, decay: 0.18, attack: 0.01 });
    this.tone({ freq: 160, freqEnd: 80, gain: 0.16, decay: 0.09 });
  }

  land(impact: number): void {
    if (impact < 3) return;
    const k = Math.min(1, impact / 16);
    this.tone({ freq: 125, freqEnd: 42, gain: 0.18 + 0.5 * k, decay: 0.12 + 0.12 * k });
    this.burst({ freq: 900 + 600 * k, freqEnd: 250, gain: 0.1 + 0.3 * k, decay: 0.1 + 0.1 * k });
  }

  slideStart(): void {
    this.burst({ type: 'bandpass', freq: 1400, freqEnd: 700, q: 0.8, gain: 0.2, decay: 0.2, attack: 0.01 });
  }

  vault(): void {
    this.burst({ type: 'bandpass', freq: 1200, freqEnd: 600, q: 0.7, gain: 0.15, decay: 0.16, attack: 0.02 });
    this.tone({ freq: 140, freqEnd: 60, gain: 0.14, decay: 0.08, delay: 0.17 });
    this.burst({ freq: 800, freqEnd: 300, gain: 0.1, decay: 0.07, delay: 0.17 });
  }

  mantle(): void {
    this.burst({ type: 'bandpass', freq: 700, freqEnd: 1300, q: 0.8, gain: 0.12, decay: 0.25, attack: 0.04 });
    this.tone({ freq: 105, freqEnd: 55, gain: 0.2, decay: 0.12, delay: 0.3 });
  }

  wallRunStart(): void {
    this.burst({ type: 'bandpass', freq: 1800, freqEnd: 2600, q: 1.2, gain: 0.12, decay: 0.12 });
    this.tone({ freq: 120, freqEnd: 60, gain: 0.12, decay: 0.07 });
  }

  checkpoint(): void {
    this.tone({ type: 'sine', freq: 784, gain: 0.2, decay: 0.7, attack: 0.01 });
    this.tone({ type: 'sine', freq: 1175, gain: 0.16, decay: 0.8, attack: 0.01, delay: 0.1 });
    this.tone({ type: 'triangle', freq: 1568, gain: 0.07, decay: 0.9, attack: 0.01, delay: 0.1 });
  }

  respawn(): void {
    this.burst({ type: 'lowpass', freq: 2500, freqEnd: 150, gain: 0.22, decay: 0.45, attack: 0.02 });
    this.tone({ freq: 180, freqEnd: 40, gain: 0.25, decay: 0.4 });
  }

  finish(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.tone({ type: 'triangle', freq: f, gain: 0.2, decay: 1.2, attack: 0.012, delay: i * 0.1 });
      this.tone({ type: 'sine', freq: f * 2, gain: 0.05, decay: 1.4, attack: 0.012, delay: i * 0.1 });
    });
    this.tone({ type: 'sine', freq: 261.6, gain: 0.18, decay: 1.8, attack: 0.02, delay: 0.38 });
    this.tone({ type: 'sine', freq: 392, gain: 0.12, decay: 1.8, attack: 0.02, delay: 0.38 });
  }

  uiClick(): void {
    this.tone({ type: 'triangle', freq: 880, freqEnd: 660, gain: 0.07, decay: 0.07, attack: 0.002 });
  }

  dispose(): void {
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.windSrc = null;
  }
}
