/** Short synthesized cues. Nothing is loaded from disk. */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private slideGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private started = false;

  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(ctx.destination);
      this.noise = this.makeNoise(ctx);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (!this.started && this.ctx.state === "running") {
      this.started = true;
      this.startBed();
    }
  }

  footstep(speed: number): void {
    if (!this.ready()) return;
    const bright = 700 + Math.min(speed, 12) * 40;
    this.burst(0.07, bright, "bandpass", 0.7, 0.12);
  }

  jump(): void {
    if (!this.ready()) return;
    this.burst(0.09, 1400, "highpass", 0.6, 0.1);
    this.tone(520, 0.06, 0.04, "triangle");
  }

  land(impact: number): void {
    if (!this.ready() || impact < 3.5) return;
    const gain = Math.min(0.28, 0.08 + impact * 0.012);
    this.burst(0.14, 180, "lowpass", 0.8, gain);
  }

  slide(active: boolean): void {
    if (!this.slideGain) return;
    const now = this.ctx!.currentTime;
    this.slideGain.gain.cancelScheduledValues(now);
    this.slideGain.gain.linearRampToValueAtTime(active ? 0.16 : 0.0001, now + 0.08);
  }

  wind(speed: number): void {
    if (!this.windGain) return;
    const amount = Math.max(0, (speed - 6) / 8);
    const now = this.ctx!.currentTime;
    this.windGain.gain.cancelScheduledValues(now);
    this.windGain.gain.linearRampToValueAtTime(0.0001 + amount * 0.12, now + 0.1);
  }

  checkpoint(): void {
    if (!this.ready()) return;
    this.tone(740, 0.08, 0.06, "sine");
    this.tone(1100, 0.12, 0.05, "sine", 0.07);
  }

  vault(): void {
    if (!this.ready()) return;
    this.burst(0.06, 900, "bandpass", 1.2, 0.08);
  }

  finish(): void {
    if (!this.ready()) return;
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => this.tone(f, 0.16, 0.06, "triangle", i * 0.09));
  }

  private ready(): boolean {
    return this.ctx !== null && this.master !== null && this.noise !== null && this.ctx.state === "running";
  }

  private startBed(): void {
    const noise = this.noise!;
    this.slideGain = this.loop(noise, "lowpass", 480, 0.0001);
    this.windGain = this.loop(noise, "bandpass", 280, 0.0001);
  }

  private loop(buffer: AudioBuffer, type: BiquadFilterType, freq: number, gain: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master!);
    src.start();
    return g;
  }

  private burst(duration: number, freq: number, type: BiquadFilterType, q: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master!);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  private tone(freq: number, duration: number, gain: number, shape: OscillatorType, delay = 0): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = shape;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
