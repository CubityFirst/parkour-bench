/**
 * Tiny procedural sound engine (Web Audio API). Every effect is synthesised
 * from noise and oscillators, so no audio files are downloaded.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private slideGain!: GainNode;
  private slideFilter!: BiquadFilterNode;
  private volume = 0.8;
  private paused = true;

  /** Must be called from a user gesture (browser autoplay policy). */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // Two seconds of white noise shared by every noise-based effect.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Continuous wind loop, gain driven by speed.
    const wind = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);

    // Continuous slide scrape loop.
    const slide = this.loopNoise();
    this.slideFilter = ctx.createBiquadFilter();
    this.slideFilter.type = 'lowpass';
    this.slideFilter.frequency.value = 1500;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    slide.connect(this.slideFilter).connect(this.slideGain).connect(this.master);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Fades out the looping wind/slide layers while paused or in menus. */
  setPaused(p: boolean): void {
    this.paused = p;
    if (!this.ctx || !p) return;
    this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    this.slideGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
    return src;
  }

  /** One-shot filtered noise burst. */
  private burst(opts: {
    type: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
    gain: number;
    attack: number;
    decay: number;
    delay?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.attack + opts.decay);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + opts.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.attack + opts.decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + opts.attack + opts.decay + 0.05);
  }

  /** One-shot oscillator tone with pitch glide. */
  private tone(type: OscillatorType, f0: number, f1: number, gain: number, attack: number, decay: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  footstep(speed: number): void {
    const k = Math.min(1, speed / 11);
    this.burst({ type: 'bandpass', freq: 700 + Math.random() * 500, q: 1.2, gain: 0.08 + 0.1 * k, attack: 0.004, decay: 0.07 });
    this.tone('sine', 110, 60, 0.07 + 0.06 * k, 0.003, 0.06);
  }

  jump(kind: 'ground' | 'slide' | 'wall'): void {
    this.burst({ type: 'bandpass', freq: 500, freqEnd: 1800, q: 0.8, gain: 0.12, attack: 0.03, decay: 0.2 });
    this.tone('sine', 140, 70, kind === 'wall' ? 0.14 : 0.1, 0.004, 0.08);
    if (kind === 'wall') this.burst({ type: 'highpass', freq: 2500, gain: 0.08, attack: 0.002, decay: 0.05 });
  }

  land(impact: number): void {
    const k = Math.min(1, impact / 18);
    this.tone('sine', 150, 40, 0.12 + 0.3 * k, 0.004, 0.12 + 0.1 * k);
    this.burst({ type: 'lowpass', freq: 900 + 600 * k, gain: 0.1 + 0.2 * k, attack: 0.003, decay: 0.1 + 0.08 * k });
  }

  vault(): void {
    this.burst({ type: 'highpass', freq: 1800, gain: 0.12, attack: 0.002, decay: 0.05 });
    this.burst({ type: 'bandpass', freq: 600, freqEnd: 1600, q: 0.7, gain: 0.12, attack: 0.04, decay: 0.22, delay: 0.03 });
  }

  mantle(): void {
    this.burst({ type: 'highpass', freq: 1600, gain: 0.1, attack: 0.002, decay: 0.05 });
    this.tone('sine', 120, 70, 0.1, 0.005, 0.1, 0.12);
  }

  wallRunStart(): void {
    this.burst({ type: 'bandpass', freq: 900, freqEnd: 400, q: 0.8, gain: 0.12, attack: 0.02, decay: 0.25 });
  }

  slideStart(): void {
    this.burst({ type: 'lowpass', freq: 2500, freqEnd: 800, gain: 0.14, attack: 0.01, decay: 0.2 });
  }

  /** Called every frame with movement info to drive the looping layers. */
  updateMovement(speed: number, sliding: boolean, airborne: boolean): void {
    const ctx = this.ctx;
    if (!ctx || this.paused) return;
    const t = ctx.currentTime;
    const windK = Math.max(0, Math.min(1, (speed - 5) / 9)) * (airborne ? 1.3 : 1);
    this.windGain.gain.setTargetAtTime(windK * 0.16, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(350 + windK * 900, t, 0.2);
    const slideK = sliding ? Math.min(1, speed / 10) : 0;
    this.slideGain.gain.setTargetAtTime(slideK * 0.18, t, sliding ? 0.03 : 0.08);
    this.slideFilter.frequency.setTargetAtTime(600 + slideK * 1800, t, 0.05);
  }

  checkpoint(): void {
    this.tone('triangle', 660, 660, 0.16, 0.01, 0.25);
    this.tone('triangle', 990, 990, 0.16, 0.01, 0.4, 0.12);
    this.tone('sine', 1980, 1980, 0.05, 0.01, 0.4, 0.12);
  }

  finish(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.tone('triangle', f, f, 0.16, 0.01, 0.5, i * 0.11);
      this.tone('sine', f * 2, f * 2, 0.04, 0.01, 0.5, i * 0.11);
    });
    this.tone('triangle', 1046.5, 1046.5, 0.12, 0.02, 1.2, 0.5);
  }

  respawn(): void {
    this.burst({ type: 'bandpass', freq: 1800, freqEnd: 300, q: 0.9, gain: 0.12, attack: 0.02, decay: 0.35 });
  }

  click(): void {
    this.tone('square', 1400, 1200, 0.03, 0.002, 0.03);
  }
}
