/** Procedural sound effects via WebAudio. No external assets. */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private windGain: GainNode | null = null;

  /** Must be called from a user gesture (button click). */
  resume(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.createNoise();
      this.startWind();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  private createNoise(): void {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 1.2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  private startWind(): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.6;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master!);
    source.start();
    this.windGain = gain;
  }

  /** Wind volume follows speed each frame. */
  level(speed: number, speedMax: number): void {
    if (!this.windGain || !this.ctx) return;
    const g = Math.max(0, Math.min(0.16, (speed / speedMax) * 0.16));
    this.windGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.15);
  }

  private noise(duration: number, freq: number, vol: number, q = 1.2, type: BiquadFilterType = 'bandpass'): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.25;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    src.stop(ctx.currentTime + duration + 0.05);
  }

  private blip(freq: number, duration: number, vol = 0.12, type: OscillatorType = 'triangle', slide = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(this.master!);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.05);
  }

  step(sprint: boolean): void {
    this.noise(0.075, sprint ? 320 : 250, sprint ? 0.2 : 0.12, 1.4);
  }
  jump(): void {
    this.noise(0.1, 280, 0.14);
    this.blip(190, 0.1, 0.05, 'sine', 80);
  }
  land(strength: number): void {
    this.noise(0.14, 160 + 160 * strength, 0.18 + strength * 0.25, 0.9, 'lowpass');
  }
  slide(start = false): void {
    this.noise(0.32, 210, start ? 0.16 : 0.09, 0.7);
  }
  wallRun(): void {
    this.noise(0.14, 300, 0.1);
  }
  vault(): void {
    this.noise(0.1, 240, 0.12);
  }
  checkpoint(): void {
    this.blip(660, 0.14, 0.12, 'triangle');
    this.blip(990, 0.2, 0.09);
  }
  finish(): void {
    this.blip(523, 0.18, 0.14, 'triangle');
    this.blip(659, 0.18, 0.14);
    this.blip(784, 0.35, 0.14);
  }
  respawn(): void {
    this.blip(220, 0.12, 0.1, 'sine', -110);
  }
  gate(): void {
    this.noise(0.08, 500, 0.09, 2);
  }
}
