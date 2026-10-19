/** Short synthesized cues. No downloaded audio files. */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private slideGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  resume(): void {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') void ctx.resume();
  }

  update(speed: number, sprint: number, sliding: boolean): void {
    if (!this.windGain || !this.slideGain || !this.windFilter) return;
    const t = this.ctx!.currentTime;
    const wind = Math.min(1, Math.max(0, (speed - 3) / sprint));
    this.windGain.gain.setTargetAtTime(wind * 0.045, t, 0.08);
    this.windFilter.frequency.setTargetAtTime(280 + wind * 900, t, 0.08);
    this.slideGain.gain.setTargetAtTime(sliding ? 0.07 : 0, t, 0.05);
  }

  footstep(speed: number): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const noise = this.burst(0.045);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 180 + Math.min(400, speed * 18);
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    noise.start(t);
    noise.stop(t + 0.06);
  }

  jump(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.09);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  land(impact: number): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110 - Math.min(40, impact), t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const gain = ctx.createGain();
    const vol = Math.min(0.22, 0.06 + impact * 0.012);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  checkpoint(): void {
    this.blip(660, 0);
    this.blip(880, 0.09);
  }

  finish(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.blip(f, i * 0.09, 0.16));
  }

  private blip(freq: number, delay: number, dur = 0.12): void {
    const ctx = this.ensure();
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private burst(dur: number): AudioBufferSourceNode {
    const ctx = this.ensure();
    const length = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    return src;
  }

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 400;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    const wind = this.noiseLoop(ctx);
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    wind.start();

    const slideFilter = ctx.createBiquadFilter();
    slideFilter.type = 'bandpass';
    slideFilter.frequency.value = 700;
    slideFilter.Q.value = 0.6;
    const slideGain = ctx.createGain();
    slideGain.gain.value = 0;
    const slide = this.noiseLoop(ctx);
    slide.connect(slideFilter);
    slideFilter.connect(slideGain);
    slideGain.connect(master);
    slide.start();

    this.ctx = ctx;
    this.master = master;
    this.windGain = windGain;
    this.slideGain = slideGain;
    this.windFilter = windFilter;
    return ctx;
  }

  private noiseLoop(ctx: AudioContext): AudioBufferSourceNode {
    const length = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }
}
