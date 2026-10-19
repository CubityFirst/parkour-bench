/** Short synthesized cues. No audio files. */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: GainNode | null = null;
  private slide: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private sliding = false;

  unlock(): void {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') void ctx.resume();
  }

  footstep(speed: number): void {
    this.blipNoise(0.045, 180 + speed * 18, 0.9, 0.07 + Math.min(0.08, speed * 0.006));
  }

  jump(): void {
    this.tone(220, 520, 0.09, 0.08, 'triangle');
  }

  land(impact: number): void {
    this.blipNoise(0.09, 140, 0.6, Math.min(0.2, 0.06 + impact * 0.008));
  }

  setSlide(active: boolean): void {
    this.sliding = active;
    if (this.slide) this.slide.gain.value = active ? 0.045 : 0;
  }

  setSpeed(speed: number, airborne: boolean): void {
    if (!this.wind) return;
    const amount = airborne ? Math.min(1, speed / 12) : Math.max(0, (speed - 7) / 8);
    this.wind.gain.value = amount * 0.05;
    if (this.slide && this.sliding) this.slide.gain.value = 0.03 + Math.min(0.04, speed * 0.003);
  }

  checkpoint(): void {
    this.tone(523, 523, 0.08, 0.06, 'sine');
    window.setTimeout(() => this.tone(784, 784, 0.14, 0.07, 'sine'), 90);
  }

  finish(): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => window.setTimeout(() => this.tone(n, n, 0.18, 0.07, 'sine'), i * 110));
  }

  respawn(): void {
    this.tone(180, 90, 0.12, 0.05, 'sine');
  }

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);
    this.master = master;
    const count = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, count, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < count; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 400;
    const wind = ctx.createGain();
    wind.gain.value = 0;
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = buffer;
    windSrc.loop = true;
    windSrc.connect(windFilter);
    windFilter.connect(wind);
    wind.connect(master);
    windSrc.start();
    this.wind = wind;

    const slideFilter = ctx.createBiquadFilter();
    slideFilter.type = 'bandpass';
    slideFilter.frequency.value = 700;
    slideFilter.Q.value = 0.7;
    const slide = ctx.createGain();
    slide.gain.value = 0;
    const slideSrc = ctx.createBufferSource();
    slideSrc.buffer = buffer;
    slideSrc.loop = true;
    slideSrc.connect(slideFilter);
    slideFilter.connect(slide);
    slide.connect(master);
    slideSrc.start();
    this.slide = slide;
    return ctx;
  }

  private tone(from: number, to: number, dur: number, vol: number, type: OscillatorType): void {
    const ctx = this.ensure();
    if (!this.master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), ctx.currentTime + dur);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  private blipNoise(dur: number, freq: number, q: number, vol: number): void {
    const ctx = this.ensure();
    if (!this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    src.stop(ctx.currentTime + dur + 0.02);
  }
}
