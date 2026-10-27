/**
 * All sound is synthesised with the Web Audio API — filtered noise for
 * footsteps, wind and cloth, short sine sweeps for thumps, and simple
 * chimes for checkpoints. No audio files are downloaded.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private slideGain!: GainNode;
  private slideFilter!: BiquadFilterNode;
  private volume = 0.7;

  /** Must be called from a user gesture (browser autoplay rules). */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // Gentle limiter so stacked sounds never clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Continuous wind (speed) and cloth-on-concrete (slide) loops.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 300;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.master);

    this.slideFilter = ctx.createBiquadFilter();
    this.slideFilter.type = 'bandpass';
    this.slideFilter.frequency.value = 1100;
    this.slideFilter.Q.value = 0.9;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    this.loopNoise().connect(this.slideFilter).connect(this.slideGain).connect(this.master);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 1.5);
    return src;
  }

  /** One-shot filtered noise burst. */
  private burst(opts: {
    type: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
    gain: number;
    attack?: number;
    decay: number;
    delay?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) filter.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.decay);
    filter.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    const attack = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + opts.decay);
    src.connect(filter).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + opts.decay + 0.05);
  }

  /** One-shot oscillator with a pitch sweep. */
  private tone(opts: { type?: OscillatorType; freq: number; freqEnd?: number; gain: number; attack?: number; decay: number; delay?: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.decay);
    const g = ctx.createGain();
    const attack = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + opts.decay);
    osc.connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + attack + opts.decay + 0.05);
  }

  footstep(speed: number, wall: boolean): void {
    const k = Math.min(1, 0.35 + speed / 14);
    const pitch = 0.85 + Math.random() * 0.3;
    this.burst({ type: 'lowpass', freq: (wall ? 1700 : 1000) * pitch, freqEnd: 300, gain: 0.32 * k, decay: 0.07 });
    this.burst({ type: 'highpass', freq: 3200 * pitch, gain: 0.05 * k, decay: 0.03 });
    this.tone({ freq: 95 * pitch, freqEnd: 50, gain: 0.22 * k, decay: 0.07 });
  }

  jump(): void {
    this.burst({ type: 'bandpass', freq: 500, freqEnd: 1600, q: 1.2, gain: 0.16, attack: 0.02, decay: 0.18 });
    this.tone({ freq: 120, freqEnd: 60, gain: 0.22, decay: 0.08 });
  }

  land(impact: number, hard: boolean): void {
    const k = Math.min(1, impact / 16);
    if (k < 0.08) return;
    this.tone({ freq: 140, freqEnd: 42, gain: 0.25 + 0.4 * k, decay: hard ? 0.28 : 0.16 });
    this.burst({ type: 'lowpass', freq: 900, freqEnd: 200, gain: 0.25 + 0.35 * k, decay: hard ? 0.22 : 0.12 });
    if (hard) this.burst({ type: 'bandpass', freq: 300, q: 0.6, gain: 0.3, decay: 0.3 });
  }

  slideStart(): void {
    this.burst({ type: 'bandpass', freq: 2200, freqEnd: 900, q: 0.8, gain: 0.18, attack: 0.01, decay: 0.2 });
  }

  vault(): void {
    this.burst({ type: 'highpass', freq: 1800, gain: 0.22, decay: 0.04 });
    this.burst({ type: 'bandpass', freq: 700, freqEnd: 1800, q: 1, gain: 0.14, attack: 0.03, decay: 0.2, delay: 0.03 });
  }

  mantle(): void {
    this.burst({ type: 'highpass', freq: 1600, gain: 0.2, decay: 0.04 });
    this.burst({ type: 'highpass', freq: 1500, gain: 0.18, decay: 0.04, delay: 0.07 });
    this.burst({ type: 'bandpass', freq: 900, freqEnd: 500, q: 0.7, gain: 0.12, attack: 0.04, decay: 0.25, delay: 0.1 });
  }

  wallrunStart(): void {
    this.burst({ type: 'bandpass', freq: 1400, freqEnd: 2400, q: 1.1, gain: 0.12, attack: 0.02, decay: 0.15 });
  }

  checkpoint(): void {
    this.tone({ type: 'sine', freq: 880, gain: 0.22, decay: 0.7 });
    this.tone({ type: 'sine', freq: 1318.5, gain: 0.18, decay: 0.9, delay: 0.09 });
    this.tone({ type: 'triangle', freq: 1760, gain: 0.05, decay: 0.6, delay: 0.09 });
  }

  finish(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      this.tone({ type: 'triangle', freq: f, gain: 0.16, decay: 1.4 - i * 0.12, delay: i * 0.09 });
      this.tone({ type: 'sine', freq: f * 2, gain: 0.04, decay: 0.8, delay: i * 0.09 });
    });
    this.burst({ type: 'bandpass', freq: 3000, freqEnd: 8000, q: 0.5, gain: 0.05, attack: 0.3, decay: 1.2 });
  }

  respawn(): void {
    this.burst({ type: 'bandpass', freq: 1800, freqEnd: 300, q: 0.9, gain: 0.15, attack: 0.05, decay: 0.45 });
    this.tone({ freq: 330, freqEnd: 660, gain: 0.08, decay: 0.3, delay: 0.25 });
  }

  click(): void {
    this.tone({ type: 'triangle', freq: 1500, freqEnd: 900, gain: 0.08, decay: 0.05 });
  }

  /** Per-frame update of the looping sounds. */
  update(speed: number, fallSpeed: number, sliding: boolean, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const windAmount = active ? Math.min(1, Math.max(0, (speed - 5) / 8) * 0.7 + Math.max(0, (fallSpeed - 6) / 20)) : 0;
    this.windGain.gain.setTargetAtTime(windAmount * 0.32, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(250 + windAmount * 900, t, 0.2);
    const slideAmount = active && sliding ? Math.min(1, speed / 12) : 0;
    this.slideGain.gain.setTargetAtTime(slideAmount * 0.22, t, sliding ? 0.03 : 0.08);
    this.slideFilter.frequency.setTargetAtTime(700 + slideAmount * 900, t, 0.1);
  }
}
