/**
 * All sound is synthesised with the Web Audio API - no assets to download.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private slideGain: GainNode | null = null;
  private slideFilter: BiquadFilterNode | null = null;

  private lastStep = 0;
  private stepFlip = 0;

  volume = 0.7;
  enabled = true;

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(ctx.destination);
    this.master = master;

    // white noise source used by wind, footsteps and slides
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;

    // --- continuous wind ---
    const wind = ctx.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 620;
    windFilter.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();
    this.windGain = windGain;
    this.windFilter = windFilter;

    // --- continuous slide ---
    const slide = ctx.createBufferSource();
    slide.buffer = buffer;
    slide.loop = true;
    const slideFilter = ctx.createBiquadFilter();
    slideFilter.type = 'lowpass';
    slideFilter.frequency.value = 1500;
    const slideGain = ctx.createGain();
    slideGain.gain.value = 0;
    slide.connect(slideFilter).connect(slideGain).connect(master);
    slide.start();
    this.slideGain = slideGain;
    this.slideFilter = slideFilter;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.enabled ? v : 0, this.ctx.currentTime, 0.05);
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.setVolume(this.volume);
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private env(
    node: AudioNode,
    peak: number,
    attack: number,
    decay: number,
    delay = 0
  ): GainNode | null {
    if (!this.ctx || !this.master) return null;
    const t = this.now() + delay;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(gain);
    gain.connect(this.master);
    return gain;
  }

  private noiseSource(duration: number): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noiseBuffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.start(this.now(), Math.random() * 1.5, duration);
    src.stop(this.now() + duration + 0.05);
    return src;
  }

  footstep(sprint: boolean): void {
    if (!this.ctx) return;
    const t = this.now();
    if (t - this.lastStep < (sprint ? 0.26 : 0.4)) return;
    this.lastStep = t;
    this.stepFlip ^= 1;

    const src = this.noiseSource(0.09);
    if (!src) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = this.stepFlip ? 1500 : 1150;
    filter.Q.value = 1.1;
    src.connect(filter);
    this.env(filter, sprint ? 0.22 : 0.13, 0.004, 0.09);
  }

  jump(): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    const t = this.now();
    osc.frequency.setValueAtTime(280, t);
    osc.frequency.exponentialRampToValueAtTime(620, t + 0.12);
    this.env(osc, 0.12, 0.01, 0.16);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  land(impact: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    const t = this.now();
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(58, t + 0.16);
    this.env(osc, Math.min(0.34, 0.12 + impact * 0.012), 0.005, 0.22);
    osc.start(t);
    osc.stop(t + 0.4);

    const src = this.noiseSource(0.14);
    if (src) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      src.connect(filter);
      this.env(filter, Math.min(0.2, 0.06 + impact * 0.008), 0.004, 0.15);
    }
  }

  slideStart(): void {
    if (!this.ctx) return;
    const src = this.noiseSource(0.35);
    if (!src) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2600;
    filter.Q.value = 0.6;
    src.connect(filter);
    this.env(filter, 0.16, 0.02, 0.32);
  }

  wallRun(): void {
    if (!this.ctx || !this.master) return;
    const src = this.noiseSource(0.5);
    if (!src) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.9;
    src.connect(filter);
    this.env(filter, 0.13, 0.04, 0.5);
  }

  vault(): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    const t = this.now();
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(760, t + 0.1);
    this.env(osc, 0.1, 0.008, 0.14);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  checkpoint(): void {
    if (!this.ctx || !this.master) return;
    [660, 990].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'sine';
      const t = this.now() + i * 0.09;
      osc.frequency.setValueAtTime(freq, t);
      this.env(osc, 0.16, 0.01, 0.22, i * 0.09);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  }

  complete(): void {
    if (!this.ctx || !this.master) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'triangle';
      const t = this.now() + i * 0.12;
      osc.frequency.setValueAtTime(freq, t);
      this.env(osc, 0.17, 0.01, 0.34, i * 0.12);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }

  /** Continuous layers, updated every frame. */
  update(speed: number, sliding: boolean): void {
    if (!this.ctx || !this.windGain || !this.windFilter || !this.slideGain) return;
    const t = this.ctx.currentTime;
    const windLevel = Math.min(0.22, Math.max(0, (speed - 6) / 8) * 0.22);
    this.windGain.gain.setTargetAtTime(windLevel, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(500 + speed * 42, t, 0.2);
    this.slideGain.gain.setTargetAtTime(sliding ? 0.14 : 0, t, sliding ? 0.03 : 0.12);
    if (this.slideFilter) {
      this.slideFilter.frequency.setTargetAtTime(sliding ? 1300 + speed * 60 : 900, t, 0.1);
    }
  }
}
