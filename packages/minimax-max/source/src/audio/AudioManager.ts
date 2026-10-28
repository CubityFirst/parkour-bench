/**
 * All sound effects are synthesised with the Web Audio API so the game ships
 * without a single audio asset.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private slideSource: AudioBufferSourceNode | null = null;
  private slideGain: GainNode | null = null;
  private windSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;

  enabled = true;

  /** Creates the audio context. Must run inside a user gesture. */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.55 : 0;
    this.master.connect(this.ctx.destination);

    // One second of white noise, reused by every effect.
    const length = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;

    this.startLoops();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(enabled ? 0.55 : 0, this.ctx.currentTime, 0.05);
    }
  }

  private startLoops(): void {
    if (!this.ctx || !this.noiseBuffer || !this.master) return;

    // Continuous slide friction.
    this.slideSource = this.ctx.createBufferSource();
    this.slideSource.buffer = this.noiseBuffer;
    this.slideSource.loop = true;
    const slideFilter = this.ctx.createBiquadFilter();
    slideFilter.type = 'bandpass';
    slideFilter.frequency.value = 900;
    slideFilter.Q.value = 0.8;
    this.slideGain = this.ctx.createGain();
    this.slideGain.gain.value = 0;
    this.slideSource.connect(slideFilter).connect(this.slideGain).connect(this.master);
    this.slideSource.start();

    // Wind that grows with the running speed.
    this.windSource = this.ctx.createBufferSource();
    this.windSource.buffer = this.noiseBuffer;
    this.windSource.loop = true;
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 700;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSource.connect(windFilter).connect(this.windGain).connect(this.master);
    this.windSource.start();
  }

  private get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private noise(duration: number): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noiseBuffer) return null;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    source.start(this.now, Math.random() * 0.8, duration + 0.05);
    return source;
  }

  /** Short footstep - filtered noise plus a soft body thump. */
  footstep(intensity = 1): void {
    if (!this.ctx || !this.master) return;
    const source = this.noise(0.12);
    if (!source) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900 + Math.random() * 700;
    filter.Q.value = 1.1;
    const gain = this.ctx.createGain();
    const t = this.now;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.16 * intensity, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    source.connect(filter).connect(gain).connect(this.master);
    source.stop(t + 0.14);
  }

  jump(): void {
    if (!this.ctx || !this.master) return;
    const source = this.noise(0.3);
    if (!source) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(420, this.now);
    filter.frequency.exponentialRampToValueAtTime(1900, this.now + 0.22);
    filter.Q.value = 1.4;
    const gain = this.ctx.createGain();
    const t = this.now;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    source.connect(filter).connect(gain).connect(this.master);
    source.stop(t + 0.32);
  }

  land(impact: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.now;
    const source = this.noise(0.22);
    if (source) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12 + impact * 0.2, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      source.connect(filter).connect(gain).connect(this.master);
      source.stop(t + 0.24);
    }
    const thump = this.ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(120, t);
    thump.frequency.exponentialRampToValueAtTime(55, t + 0.16);
    const thumpGain = this.ctx.createGain();
    thumpGain.gain.setValueAtTime(0.0001, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.1 + impact * 0.16, t + 0.01);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    thump.connect(thumpGain).connect(this.master);
    thump.start(t);
    thump.stop(t + 0.22);
  }

  slideStart(): void {
    if (!this.ctx || !this.slideGain) return;
    this.slideGain.gain.setTargetAtTime(0.2, this.now, 0.03);
  }

  slideStop(): void {
    if (!this.ctx || !this.slideGain) return;
    this.slideGain.gain.setTargetAtTime(0, this.now, 0.05);
  }

  /** Wind intensity between 0 and 1. */
  setWind(amount: number): void {
    if (!this.ctx || !this.windGain) return;
    this.windGain.gain.setTargetAtTime(Math.min(0.32, amount * 0.32), this.now, 0.12);
  }

  checkpoint(): void {
    if (!this.ctx || !this.master) return;
    const t = this.now;
    this.tone(880, t, 0.28, 0.16);
    this.tone(1320, t + 0.11, 0.3, 0.13);
  }

  complete(): void {
    if (!this.ctx || !this.master) return;
    const t = this.now;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((frequency, index) => {
      this.tone(frequency, t + index * 0.12, 0.55, 0.16);
    });
  }

  fall(): void {
    if (!this.ctx || !this.master) return;
    const t = this.now;
    const source = this.noise(0.5);
    if (!source) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, t);
    filter.frequency.exponentialRampToValueAtTime(180, t + 0.45);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    source.connect(filter).connect(gain).connect(this.master);
    source.stop(t + 0.52);
  }

  private tone(frequency: number, at: number, duration: number, volume: number): void {
    if (!this.ctx || !this.master) return;
    const oscillator = this.ctx.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.05);
  }
}
