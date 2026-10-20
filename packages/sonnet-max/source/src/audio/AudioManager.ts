/**
 * All game audio is synthesised with the Web Audio API at runtime: filtered noise bursts for
 * footsteps / landings / whooshes, short oscillator tones for UI and jingles, and a few persistent
 * noise loops (wind, slide scrape, city bed) whose gains follow the player's movement.
 * No sample files, so nothing to download.
 */
export interface AudioFrameState {
  speed: number;
  grounded: boolean;
  sliding: boolean;
  wallrun: boolean;
  scripted: boolean;
  /** 0..1 - the game is actively being played (not paused / in a menu). */
  active: boolean;
}

interface Loop {
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: Loop | null = null;
  private scrape: Loop | null = null;
  private bed: Loop | null = null;
  private volume = 0.7;
  private stepFlip = false;
  private lastStep = 0;

  /** Create the audio graph. Must be called from a user gesture (the Start button). */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // 2 s of white noise shared by every effect.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.wind = this.makeLoop('bandpass', 500, 0.6);
    this.scrape = this.makeLoop('bandpass', 1800, 1.1);
    this.bed = this.makeLoop('lowpass', 260, 0.5);
    this.bed.gain.gain.value = 0.035;
    void ctx.resume();
  }

  get ready(): boolean {
    return this.ctx !== null && this.master !== null;
  }

  /** Debug: returns the current peak level (0..1) of the master bus and the AudioContext state. */
  private analyser: AnalyserNode | null = null;
  private analyserBuf: Float32Array<ArrayBuffer> | null = null;
  debugLevel(): { state: string; peak: number } {
    if (!this.ctx || !this.master) return { state: 'none', peak: 0 };
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyserBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
      this.master.connect(this.analyser);
    }
    this.analyser.getFloatTimeDomainData(this.analyserBuf!);
    let peak = 0;
    for (let i = 0; i < this.analyserBuf!.length; i++) peak = Math.max(peak, Math.abs(this.analyserBuf![i]!));
    return { state: this.ctx.state, peak };
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  private makeLoop(type: BiquadFilterType, freq: number, q: number): Loop {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = 0.1;
    src.loopEnd = 1.9;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    src.start(0, Math.random() * 1.5);
    return { src, filter, gain };
  }

  // ------------------------------------------------------------------------------------------
  // Continuous layers
  // ------------------------------------------------------------------------------------------

  update(_dt: number, s: AudioFrameState): void {
    if (!this.ctx || !this.wind || !this.scrape || !this.bed) return;
    const t = this.ctx.currentTime;
    const tau = 0.08;
    const airborne = !s.grounded && !s.sliding && !s.wallrun && !s.scripted;
    const speedK = smoothstep(2.5, 11.5, s.speed);
    const windGain = s.active ? 0.012 + 0.2 * speedK * speedK + (airborne ? 0.06 * smoothstep(2, 9, s.speed) : 0) : 0;
    this.wind.gain.gain.setTargetAtTime(windGain, t, tau);
    this.wind.filter.frequency.setTargetAtTime(380 + 1500 * speedK, t, 0.1);

    let scrapeGain = 0;
    let scrapeFreq = 1500;
    if (s.active && s.sliding) {
      scrapeGain = 0.1 + 0.16 * smoothstep(2.5, 10, s.speed);
      scrapeFreq = 700 + s.speed * 130;
    } else if (s.active && s.wallrun) {
      scrapeGain = 0.07 + 0.05 * speedK;
      scrapeFreq = 2300 + s.speed * 60;
    }
    this.scrape.gain.gain.setTargetAtTime(scrapeGain, t, 0.05);
    this.scrape.filter.frequency.setTargetAtTime(scrapeFreq, t, 0.08);
  }

  // ------------------------------------------------------------------------------------------
  // One-shots
  // ------------------------------------------------------------------------------------------

  private burst(opts: {
    type: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
    gain: number;
    attack?: number;
    dur: number;
    delay?: number;
  }): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.dur);
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 1.6);
    src.stop(t + opts.dur + 0.05);
  }

  private tone(opts: {
    type?: OscillatorType;
    f0: number;
    f1?: number;
    gain: number;
    attack?: number;
    dur: number;
    delay?: number;
  }): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1) osc.frequency.exponentialRampToValueAtTime(opts.f1, t + opts.dur);
    const g = ctx.createGain();
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + opts.dur + 0.05);
  }

  footstep(sprint: boolean, speed: number, wall: boolean): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastStep < 0.07) return;
    this.lastStep = now;
    this.stepFlip = !this.stepFlip;
    const k = 0.7 + 0.5 * clamp01(speed / 10);
    const pitch = (this.stepFlip ? 1 : 0.88) * (0.92 + Math.random() * 0.2);
    if (wall) {
      this.burst({ type: 'bandpass', freq: 2200 * pitch, q: 1.2, gain: 0.12 * k, dur: 0.07 });
      this.tone({ f0: 160 * pitch, f1: 90, gain: 0.07 * k, dur: 0.08 });
      return;
    }
    this.burst({ type: 'bandpass', freq: 1500 * pitch, q: 0.9, gain: (sprint ? 0.2 : 0.14) * k, dur: 0.075 });
    this.burst({ type: 'lowpass', freq: 420 * pitch, q: 0.7, gain: (sprint ? 0.22 : 0.15) * k, dur: 0.09 });
    this.tone({ f0: 105 * pitch, f1: 58, gain: (sprint ? 0.2 : 0.13) * k, dur: 0.09 });
  }

  jump(kind: 'ground' | 'coyote' | 'slide' | 'wall'): void {
    this.burst({ type: 'highpass', freq: 1800, freqEnd: 3400, q: 0.6, gain: 0.07, dur: 0.14 });
    this.tone({ type: 'triangle', f0: 190, f1: 400, gain: 0.06, dur: 0.12 });
    this.tone({ f0: 100, f1: 60, gain: 0.11, dur: 0.1 });
    if (kind === 'wall') this.burst({ type: 'bandpass', freq: 1400, q: 1, gain: 0.12, dur: 0.12 });
  }

  land(impact: number, rolled: boolean): void {
    const k = clamp01(impact / 18);
    if (rolled) {
      this.burst({ type: 'bandpass', freq: 800, freqEnd: 300, q: 0.8, gain: 0.16 + 0.1 * k, dur: 0.25 });
      this.tone({ f0: 95, f1: 45, gain: 0.14, dur: 0.14 });
      return;
    }
    this.tone({ f0: 120, f1: 38, gain: 0.12 + 0.34 * k, dur: 0.14 + 0.1 * k });
    this.burst({ type: 'lowpass', freq: 650, freqEnd: 200, q: 0.7, gain: 0.12 + 0.3 * k, dur: 0.13 + 0.12 * k });
    this.burst({ type: 'bandpass', freq: 1500, q: 0.9, gain: 0.05 + 0.1 * k, dur: 0.07 });
  }

  slideStart(): void {
    this.burst({ type: 'bandpass', freq: 500, freqEnd: 1800, q: 0.9, gain: 0.2, dur: 0.22 });
  }

  wallRunStart(): void {
    this.burst({ type: 'bandpass', freq: 900, freqEnd: 2600, q: 1.1, gain: 0.17, dur: 0.18 });
    this.tone({ f0: 140, f1: 70, gain: 0.1, dur: 0.1 });
  }

  vault(): void {
    this.burst({ type: 'bandpass', freq: 400, freqEnd: 1500, q: 0.8, gain: 0.2, dur: 0.2 });
    this.tone({ f0: 150, f1: 70, gain: 0.2, dur: 0.07, delay: 0.06 });
    this.burst({ type: 'lowpass', freq: 520, q: 0.7, gain: 0.18, dur: 0.1, delay: 0.06 });
  }

  mantle(): void {
    this.burst({ type: 'bandpass', freq: 700, freqEnd: 350, q: 0.9, gain: 0.18, dur: 0.28 });
    this.tone({ f0: 130, f1: 60, gain: 0.2, dur: 0.1, delay: 0.1 });
    this.tone({ f0: 100, f1: 50, gain: 0.26, dur: 0.14, delay: 0.38 });
    this.burst({ type: 'lowpass', freq: 600, q: 0.7, gain: 0.2, dur: 0.12, delay: 0.38 });
  }

  bump(): void {
    this.tone({ f0: 90, f1: 40, gain: 0.22, dur: 0.12 });
    this.burst({ type: 'lowpass', freq: 500, q: 0.7, gain: 0.18, dur: 0.1 });
  }

  checkpoint(): void {
    this.tone({ f0: 880, gain: 0.16, dur: 0.7, attack: 0.008 });
    this.tone({ f0: 1318.5, gain: 0.15, dur: 0.9, attack: 0.008, delay: 0.1 });
    this.tone({ type: 'triangle', f0: 1760, gain: 0.05, dur: 0.9, delay: 0.1 });
    this.burst({ type: 'highpass', freq: 5000, q: 0.5, gain: 0.04, dur: 0.4, delay: 0.1 });
  }

  finish(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      this.tone({ f0: f, gain: 0.17, dur: 1.2, attack: 0.01, delay: i * 0.1 });
      this.tone({ type: 'triangle', f0: f * 2, gain: 0.04, dur: 1.2, delay: i * 0.1 });
    });
    this.burst({ type: 'highpass', freq: 3500, q: 0.5, gain: 0.07, dur: 1.2, attack: 0.5 });
  }

  respawn(): void {
    this.tone({ f0: 340, f1: 70, gain: 0.2, dur: 0.3 });
    this.burst({ type: 'lowpass', freq: 1800, freqEnd: 120, q: 0.8, gain: 0.22, dur: 0.32 });
  }

  click(): void {
    this.tone({ type: 'square', f0: 1300, f1: 900, gain: 0.04, dur: 0.04 });
  }
}
