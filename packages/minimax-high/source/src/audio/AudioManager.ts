/**
 * Lightweight sound design built entirely with the Web Audio API.
 * No audio assets are loaded - every sound is synthesised on the fly.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private windSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private slideSource: AudioBufferSourceNode | null = null;
  private slideGain: GainNode | null = null;

  private _volume = 0.7;
  private _muted = false;

  get volume(): number {
    return this._volume;
  }

  set volume(value: number) {
    this._volume = Math.max(0, Math.min(1, value));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        this._muted ? 0 : this._volume,
        this.ctx.currentTime,
        0.05
      );
    }
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(value: boolean) {
    this._muted = value;
    this.volume = this._volume;
  }

  /** Creates the audio graph. Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this._muted ? 0 : this._volume;
    master.connect(ctx.destination);
    this.master = master;

    // Two seconds of white noise, reused by every noise based sound.
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;

    // --- wind bed ------------------------------------------------------
    const windSource = ctx.createBufferSource();
    windSource.buffer = buffer;
    windSource.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 620;
    windFilter.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSource.connect(windFilter).connect(windGain).connect(master);
    windSource.start();
    this.windSource = windSource;
    this.windGain = windGain;

    // --- slide bed -----------------------------------------------------
    const slideSource = ctx.createBufferSource();
    slideSource.buffer = buffer;
    slideSource.loop = true;
    const slideFilter = ctx.createBiquadFilter();
    slideFilter.type = 'bandpass';
    slideFilter.frequency.value = 2400;
    slideFilter.Q.value = 1.1;
    const slideGain = ctx.createGain();
    slideGain.gain.value = 0;
    slideSource.connect(slideFilter).connect(slideGain).connect(master);
    slideSource.start();
    this.slideSource = slideSource;
    this.slideGain = slideGain;
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  private burst(
    options: {
      duration: number;
      frequency: number;
      endFrequency?: number;
      type: BiquadFilterType;
      gain: number;
      delay?: number;
    }
  ): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + (options.delay ?? 0);

    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = options.type;
    filter.frequency.setValueAtTime(options.frequency, now);
    if (options.endFrequency !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, options.endFrequency),
        now + options.duration
      );
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(options.gain, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);

    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + options.duration + 0.02);
  }

  private tone(
    frequency: number,
    duration: number,
    gain: number,
    type: OscillatorType = 'sine',
    delay = 0
  ): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  footstep(sprinting: boolean): void {
    this.burst({
      duration: sprinting ? 0.075 : 0.1,
      frequency: sprinting ? 1500 : 1100,
      endFrequency: sprinting ? 420 : 300,
      type: 'bandpass',
      gain: sprinting ? 0.16 : 0.1,
    });
    this.tone(sprinting ? 92 : 78, 0.07, sprinting ? 0.05 : 0.03, 'sine');
  }

  jump(): void {
    this.burst({
      duration: 0.18,
      frequency: 480,
      endFrequency: 1900,
      type: 'bandpass',
      gain: 0.11,
    });
    this.tone(300, 0.14, 0.04, 'triangle');
  }

  land(impact: number): void {
    const strength = Math.max(0.2, Math.min(1, impact));
    this.burst({
      duration: 0.13 + strength * 0.1,
      frequency: 900,
      endFrequency: 180,
      type: 'lowpass',
      gain: 0.09 + strength * 0.14,
    });
    this.tone(70, 0.16, 0.06 + strength * 0.07, 'sine');
  }

  startSlide(): void {
    if (!this.ctx || !this.slideGain) return;
    this.slideGain.gain.setTargetAtTime(0.16, this.ctx.currentTime, 0.05);
  }

  stopSlide(): void {
    if (!this.ctx || !this.slideGain) return;
    this.slideGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
  }

  /** Wind intensity, 0..1, driven by the player speed. */
  setWind(intensity: number): void {
    if (!this.ctx || !this.windGain) return;
    const value = Math.max(0, Math.min(1, intensity));
    this.windGain.gain.setTargetAtTime(value * value * 0.13, this.ctx.currentTime, 0.12);
  }

  vault(): void {
    this.burst({
      duration: 0.16,
      frequency: 2600,
      endFrequency: 700,
      type: 'bandpass',
      gain: 0.1,
    });
  }

  wallRun(): void {
    this.burst({
      duration: 0.35,
      frequency: 1800,
      endFrequency: 2600,
      type: 'bandpass',
      gain: 0.09,
    });
  }

  checkpoint(): void {
    this.tone(880, 0.16, 0.09, 'triangle');
    this.tone(1320, 0.2, 0.07, 'triangle', 0.09);
  }

  finish(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((note, index) => {
      this.tone(note, 0.45, 0.11, 'triangle', index * 0.11);
    });
    this.tone(261.63, 1.1, 0.07, 'sine', 0.1);
  }

  dispose(): void {
    this.windSource?.stop();
    this.slideSource?.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
