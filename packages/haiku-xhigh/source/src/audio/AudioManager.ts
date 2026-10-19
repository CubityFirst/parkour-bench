/**
 * Procedural sound effects built with the Web Audio API. Nothing is loaded from disk.
 * Every sound is a short oscillator or filtered-noise burst, so the game stays quiet and light.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private slideGain: GainNode | null = null;

  /** Creates the audio graph. Must be called from a user gesture (the Start button) to satisfy autoplay rules. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise(1.5);
      this.startWind();
      this.startSlideLoop();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Light footstep tick on the rooftop. */
  step(): void {
    this.burst(900 + Math.random() * 400, 0.05, 0.12, 'bandpass');
  }

  jump(): void {
    this.sweep('sine', 240, 480, 0.12, 0.12);
  }

  /** Thump scaled by impact speed. Soft landings are almost silent. */
  land(impact: number): void {
    const level = Math.min(0.35, impact * 0.02);
    if (level < 0.01) return;
    this.sweep('sine', 120, 55, 0.16, level);
    this.burst(300, 0.08, level * 0.6, 'lowpass');
  }

  slideStart(): void {
    this.rampSlide(0.1);
  }

  slideEnd(): void {
    this.rampSlide(0);
  }

  wallRunStart(): void {
    this.burst(400, 0.35, 0.12, 'bandpass', 1200);
  }

  vault(): void {
    this.burst(600, 0.18, 0.12, 'bandpass', 1400);
    this.sweep('triangle', 180, 260, 0.1, 0.08);
  }

  checkpoint(): void {
    this.tone(660, 0.12, 0.14, 0);
    this.tone(880, 0.16, 0.14, 0.09);
  }

  complete(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 0.16, i * 0.12));
  }

  /** Wind bed: louder and brighter as the player moves faster. `amount` is 0..1. */
  setWind(amount: number): void {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.01 + amount * 0.09, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(400 + amount * 1400, t, 0.2);
  }

  private startWind(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 400;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.01;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.windFilter = filter;
    this.windGain = gain;
  }

  private startSlideLoop(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.slideGain = gain;
  }

  private rampSlide(target: number): void {
    if (!this.ctx || !this.slideGain) return;
    const t = this.ctx.currentTime;
    this.slideGain.gain.cancelScheduledValues(t);
    this.slideGain.gain.setTargetAtTime(target, t, 0.05);
  }

  private tone(freq: number, dur: number, peak: number, delay: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private sweep(type: OscillatorType, fromHz: number, toHz: number, dur: number, peak: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, t);
    osc.frequency.exponentialRampToValueAtTime(toHz, t + dur);
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Short filtered noise. If `sweepTo` is given the filter frequency glides to it (a whoosh). */
  private burst(freq: number, dur: number, peak: number, type: BiquadFilterType, sweepTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    filter.Q.value = 1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
