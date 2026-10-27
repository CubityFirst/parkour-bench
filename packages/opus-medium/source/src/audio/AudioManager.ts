/**
 * All sound is synthesised with the Web Audio API - no audio files.
 * Noise bursts through filters make footsteps / wind / slides, simple
 * oscillators make the UI chimes.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private slideGain!: GainNode;
  volume = 0.8;

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * 0.6;
    this.master.connect(ctx.destination);

    // 2 s of white noise, reused everywhere.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Continuous wind loop, volume driven by speed.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise; wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    // Continuous slide scrape loop.
    const slide = ctx.createBufferSource();
    slide.buffer = this.noise; slide.loop = true; slide.playbackRate.value = 0.7;
    const sf = ctx.createBiquadFilter();
    sf.type = 'lowpass'; sf.frequency.value = 1400;
    this.slideGain = ctx.createGain(); this.slideGain.gain.value = 0;
    slide.connect(sf).connect(this.slideGain).connect(this.master);
    slide.start();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v * 0.6;
  }

  suspend(): void { void this.ctx?.suspend(); }
  resume(): void { void this.ctx?.resume(); }

  private burst(opts: { freq: number; q?: number; type?: BiquadFilterType; gain: number; attack?: number; decay: number; rate?: number }): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = opts.rate ?? 1;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass'; f.frequency.value = opts.freq; f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (opts.attack ?? 0.004) + opts.decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + opts.decay + 0.1);
  }

  private tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + start;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  footstep(speed: number): void {
    this.burst({ freq: 900 + Math.random() * 500, q: 1.2, gain: 0.12 + Math.min(speed, 11) * 0.012, decay: 0.07 });
    this.tone(90 + Math.random() * 20, 0, 0.06, 0.08, 'sine', 50);
  }

  jump(): void {
    this.burst({ freq: 1200, q: 0.8, gain: 0.12, decay: 0.18, attack: 0.02, rate: 1.4 });
    this.tone(160, 0, 0.1, 0.08, 'triangle', 90);
  }

  land(impact: number): void {
    const k = Math.min(1, impact / 22);
    this.burst({ freq: 400 + k * 200, q: 0.9, gain: 0.15 + k * 0.35, decay: 0.12 + k * 0.12, type: 'lowpass' });
    this.tone(70, 0, 0.18, 0.12 + k * 0.25, 'sine', 40);
  }

  vault(): void {
    this.burst({ freq: 1800, q: 1, gain: 0.12, decay: 0.12, attack: 0.01 });
    this.burst({ freq: 700, q: 1, gain: 0.15, decay: 0.08 });
  }

  wallRun(): void {
    this.burst({ freq: 2500, q: 0.6, gain: 0.08, decay: 0.25, attack: 0.03 });
  }

  checkpoint(): void {
    this.tone(660, 0, 0.25, 0.18, 'triangle');
    this.tone(990, 0.1, 0.4, 0.16, 'triangle');
  }

  finish(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.11, 0.5, 0.16, 'triangle'));
    this.tone(1568, 0.5, 0.9, 0.08, 'sine');
  }

  uiClick(): void { this.tone(880, 0, 0.06, 0.06, 'square'); }

  respawn(): void { this.tone(300, 0, 0.25, 0.12, 'sine', 600); }

  /** Per-frame continuous sounds. */
  update(speed: number, sliding: boolean, airborne: boolean): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const windTarget = Math.max(0, (speed - 4) / 10) * (airborne ? 0.45 : 0.25);
    this.windGain.gain.setTargetAtTime(windTarget, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(350 + speed * 60, t, 0.2);
    this.slideGain.gain.setTargetAtTime(sliding ? 0.12 + Math.min(speed, 13) * 0.012 : 0, t, sliding ? 0.03 : 0.08);
  }
}
