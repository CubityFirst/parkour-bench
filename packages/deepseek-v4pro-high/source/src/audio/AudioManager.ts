/**
 * Procedural sound effects generated with the Web Audio API — no audio assets
 * required. Sounds are lightweight noise bursts and oscillator blips tuned for
 * movement feedback. The AudioContext is created lazily on the first user
 * gesture (clicking Start), which satisfies browser autoplay policies.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private muted = false;

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.startWind();
    } catch {
      this.ctx = null;
      return null;
    }
    return this.ctx;
  }

  /** Call on a user gesture to unlock audio. */
  unlock(): void {
    this.ensure();
    this.ctx?.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  private startWind(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const size = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 620;
    filter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(filter);
    filter.connect(this.windGain);
    this.windGain.connect(this.master);
    src.start();
  }

  /** Crossfade wind volume based on player speed (0..1). */
  setWind(intensity: number): void {
    if (!this.ctx || !this.windGain || this.muted) return;
    const target = Math.max(0, Math.min(1, intensity)) * 0.32;
    this.windGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
  }

  private blip(freq: number, dur: number, type: OscillatorType, vol: number, glideTo?: number): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  private noise(dur: number, vol: number, filterFreq: number, type: BiquadFilterType = 'lowpass'): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const size = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  footstep(): void {
    this.noise(0.055, 0.1, 850);
  }

  jump(): void {
    this.blip(300, 0.14, 'sine', 0.18, 560);
  }

  land(fallSpeed: number): void {
    this.noise(0.09, Math.min(0.4, 0.1 + fallSpeed * 0.028), 200);
    this.blip(150, 0.1, 'sine', 0.14, 80);
  }

  slide(): void {
    this.noise(0.28, 0.22, 720);
  }

  wallRun(): void {
    this.noise(0.3, 0.14, 520, 'bandpass');
  }

  vault(): void {
    this.blip(400, 0.14, 'triangle', 0.15, 720);
  }

  mantle(): void {
    this.blip(300, 0.12, 'triangle', 0.13, 500);
  }

  checkpoint(): void {
    this.blip(660, 0.12, 'sine', 0.2);
    setTimeout(() => this.blip(880, 0.18, 'sine', 0.2), 95);
  }

  finish(): void {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.24, 'sine', 0.2), i * 130),
    );
  }
}
