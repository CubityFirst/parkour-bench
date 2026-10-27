/**
 * Procedural sound effects with the Web Audio API: no audio files are downloaded.
 * Everything is built from a shared noise buffer, filters and simple oscillators.
 */

interface Loop {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: Loop | null = null;
  private slide: Loop | null = null;
  private zip: Loop | null = null;
  private volume = 0.7;
  private stepFlip = false;

  /** Creates/resumes the audio context. Must run inside a user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        const ctx = new Ctor();
        this.ctx = ctx;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        this.master = ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(comp).connect(ctx.destination);
        this.noise = this.makeNoise(ctx);
        this.wind = this.makeLoop('bandpass', 420, 0.6);
        this.slide = this.makeLoop('bandpass', 900, 0.8);
        this.zip = this.makeLoop('bandpass', 2600, 5);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Silences the continuous loops (pause, menus). */
  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    if (paused) {
      for (const l of [this.wind, this.slide, this.zip]) l?.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Slightly pink-ish noise: softer than pure white.
      const w = Math.random() * 2 - 1;
      last = last * 0.55 + w * 0.45;
      data[i] = last * 1.6;
    }
    return buf;
  }

  private makeLoop(type: BiquadFilterType, freq: number, q: number): Loop | null {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return null;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master);
    source.start(0, Math.random() * 1.5);
    return { source, filter, gain };
  }

  /** One-shot filtered noise burst. */
  private burst(opts: { type: BiquadFilterType; freq: number; freqEnd?: number; q?: number; gain: number; attack?: number; decay: number; delay?: number }): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.decay);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const attack = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + opts.decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, attack + opts.decay + 0.05);
  }

  /** One-shot oscillator tone with a pitch glide. */
  private tone(opts: { type: OscillatorType; freq: number; freqEnd?: number; gain: number; attack?: number; decay: number; delay?: number }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.decay);
    const g = ctx.createGain();
    const attack = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + opts.decay);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + attack + opts.decay + 0.05);
  }

  // ------------------------------------------------------------------ movement

  footstep(intensity: number, metal: boolean, wall: boolean): void {
    if (!this.ctx) return;
    this.stepFlip = !this.stepFlip;
    const k = Math.min(1.2, intensity);
    const pitch = this.stepFlip ? 1 : 0.88;
    if (wall) {
      this.burst({ type: 'bandpass', freq: 1700 * pitch, q: 1.4, gain: 0.12 * k, decay: 0.05 });
      this.tone({ type: 'sine', freq: 170 * pitch, freqEnd: 90, gain: 0.12 * k, decay: 0.06 });
      return;
    }
    this.burst({ type: 'bandpass', freq: (900 + Math.random() * 500) * pitch, q: 0.9, gain: 0.16 * k, decay: 0.065 });
    this.tone({ type: 'sine', freq: 125 * pitch, freqEnd: 55, gain: 0.22 * k, decay: 0.08 });
    if (metal) {
      this.burst({ type: 'bandpass', freq: 3100 * pitch, q: 9, gain: 0.07 * k, decay: 0.16 });
      this.tone({ type: 'triangle', freq: 640 * pitch, freqEnd: 600, gain: 0.03 * k, decay: 0.2 });
    }
  }

  jump(): void {
    this.burst({ type: 'bandpass', freq: 500, freqEnd: 1700, q: 0.8, gain: 0.11, attack: 0.02, decay: 0.18 });
    this.tone({ type: 'sine', freq: 110, freqEnd: 70, gain: 0.16, decay: 0.08 });
  }

  land(impact: number, hard: boolean): void {
    const k = Math.min(1.4, impact / 12);
    this.tone({ type: 'sine', freq: 150, freqEnd: 42, gain: 0.32 * k, decay: hard ? 0.24 : 0.13 });
    this.burst({ type: 'lowpass', freq: 1100, q: 0.7, gain: 0.22 * k, decay: hard ? 0.2 : 0.1 });
    if (hard) this.burst({ type: 'bandpass', freq: 380, q: 1, gain: 0.2, decay: 0.3 });
  }

  vault(): void {
    this.burst({ type: 'bandpass', freq: 2100, q: 1.6, gain: 0.16, decay: 0.035 });
    this.burst({ type: 'bandpass', freq: 600, freqEnd: 1900, q: 0.8, gain: 0.1, attack: 0.03, decay: 0.22, delay: 0.03 });
  }

  mantle(): void {
    this.burst({ type: 'bandpass', freq: 2000, q: 1.6, gain: 0.15, decay: 0.035 });
    this.burst({ type: 'bandpass', freq: 1800, q: 1.6, gain: 0.12, decay: 0.035, delay: 0.07 });
    this.burst({ type: 'bandpass', freq: 400, freqEnd: 900, q: 0.7, gain: 0.08, attack: 0.05, decay: 0.25, delay: 0.05 });
  }

  wallRunStart(): void {
    this.burst({ type: 'bandpass', freq: 1500, q: 1.2, gain: 0.14, decay: 0.05 });
  }

  wallJump(): void {
    this.burst({ type: 'bandpass', freq: 1600, q: 1.4, gain: 0.15, decay: 0.04 });
    this.jump();
  }

  slideStart(): void {
    const ctx = this.ctx;
    if (!ctx || !this.slide) return;
    this.burst({ type: 'bandpass', freq: 700, q: 0.8, gain: 0.14, decay: 0.12 });
    this.slide.gain.gain.setTargetAtTime(0.16, ctx.currentTime, 0.03);
  }

  slideStop(): void {
    const ctx = this.ctx;
    if (!ctx || !this.slide) return;
    this.slide.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
  }

  zipStart(): void {
    this.burst({ type: 'bandpass', freq: 2600, q: 6, gain: 0.12, decay: 0.12 });
    this.tone({ type: 'triangle', freq: 880, freqEnd: 820, gain: 0.04, decay: 0.25 });
  }

  zipStop(): void {
    const ctx = this.ctx;
    if (!ctx || !this.zip) return;
    this.zip.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  }

  /** Continuous sounds that follow the player's state every frame. */
  updateLoops(speed: number, airborne: boolean, sliding: boolean, zipSpeed: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.wind || !this.slide || !this.zip) return;
    const t = ctx.currentTime;
    const w = Math.max(0, Math.min(1, (speed - 4.5) / 10));
    const windGain = (w * w * 0.2 + (airborne && speed > 3 ? 0.03 : 0)) * (zipSpeed > 0 ? 1.4 : 1);
    this.wind.gain.gain.setTargetAtTime(windGain, t, 0.15);
    this.wind.filter.frequency.setTargetAtTime(300 + speed * 55, t, 0.2);
    if (sliding) this.slide.filter.frequency.setTargetAtTime(500 + speed * 70, t, 0.05);
    this.zip.gain.gain.setTargetAtTime(zipSpeed > 0 ? 0.05 + zipSpeed * 0.006 : 0, t, 0.08);
    this.zip.filter.frequency.setTargetAtTime(1800 + zipSpeed * 90, t, 0.1);
  }

  // ------------------------------------------------------------------ game events

  checkpoint(): void {
    this.tone({ type: 'triangle', freq: 1046.5, gain: 0.11, decay: 0.5 });
    this.tone({ type: 'sine', freq: 523.25, gain: 0.08, decay: 0.6 });
    this.tone({ type: 'triangle', freq: 1568, gain: 0.1, decay: 0.7, delay: 0.09 });
  }

  finish(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => this.tone({ type: 'triangle', freq: f, gain: 0.1, decay: 1.1, delay: i * 0.085 }));
    [261.63, 392, 523.25].forEach((f) => this.tone({ type: 'sine', freq: f, gain: 0.07, attack: 0.08, decay: 1.8, delay: 0.4 }));
  }

  respawn(): void {
    this.burst({ type: 'bandpass', freq: 3200, freqEnd: 260, q: 1.2, gain: 0.12, attack: 0.03, decay: 0.38 });
  }

  click(): void {
    this.tone({ type: 'sine', freq: 1350, gain: 0.04, decay: 0.03 });
  }
}
