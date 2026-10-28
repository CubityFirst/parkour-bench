/**
 * All sound effects are synthesised with the Web Audio API — no audio files
 * are downloaded. The palette is deliberately dry and short so the sounds
 * support the movement feedback without ever getting in the way.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private slideGain: GainNode | null = null;
  private slideFilter: BiquadFilterNode | null = null;

  enabled = true;

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.55 : 0;
    this.master.connect(this.ctx.destination);

    // --- shared white noise buffer ---------------------------------------
    const length = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;

    // --- wind loop -------------------------------------------------------
    const wind = this.ctx.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    const wf = this.ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 620;
    wf.Q.value = 0.7;
    const wg = this.ctx.createGain();
    wg.gain.value = 0;
    wind.connect(wf).connect(wg).connect(this.master);
    wind.start();
    this.windFilter = wf;
    this.windGain = wg;

    // --- slide loop ------------------------------------------------------
    const slide = this.ctx.createBufferSource();
    slide.buffer = buffer;
    slide.loop = true;
    const sf = this.ctx.createBiquadFilter();
    sf.type = 'lowpass';
    sf.frequency.value = 1400;
    sf.Q.value = 0.9;
    const sg = this.ctx.createGain();
    sg.gain.value = 0;
    slide.connect(sf).connect(sg).connect(this.master);
    slide.start();
    this.slideFilter = sf;
    this.slideGain = sg;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
    }
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Short filtered noise burst — used for footsteps and impacts. */
  private noiseBurst(duration: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass'): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(env).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  private tone(freq: number, duration: number, gain: number, type: OscillatorType = 'sine', slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t + duration);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  footstep(sprint: boolean): void {
    this.noiseBurst(sprint ? 0.11 : 0.16, sprint ? 1500 : 950, 1.1, sprint ? 0.16 : 0.11, 'bandpass');
    this.noiseBurst(0.08, 220, 0.9, 0.07, 'lowpass');
  }

  jump(): void {
    this.noiseBurst(0.1, 700, 1.2, 0.09);
    this.tone(190, 0.16, 0.09, 'sine', 420);
  }

  land(strength: number): void {
    const s = Math.min(1, strength / 26);
    this.noiseBurst(0.22, 260 + s * 220, 0.8, 0.1 + s * 0.16, 'lowpass');
    this.tone(90, 0.2, 0.08 + s * 0.1, 'sine', 55);
  }

  slideStart(): void {
    this.noiseBurst(0.3, 900, 0.7, 0.14, 'bandpass');
  }

  slideEnd(): void {
    this.noiseBurst(0.16, 500, 0.8, 0.07, 'bandpass');
  }

  vault(): void {
    this.noiseBurst(0.18, 420, 0.9, 0.1, 'lowpass');
  }

  wallRun(): void {
    this.noiseBurst(0.25, 1250, 1.4, 0.1);
  }

  checkpoint(): void {
    this.tone(660, 0.12, 0.12, 'triangle');
    window.setTimeout(() => this.tone(990, 0.2, 0.11, 'triangle'), 110);
  }

  finish(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      window.setTimeout(() => this.tone(n, 0.32, 0.13, 'triangle'), i * 105);
    });
  }

  /** Continuous wind + slide loops follow the player state. */
  update(speed: number, sliding: boolean, maxSpeed: number): void {
    if (!this.ctx || !this.windGain || !this.slideGain) return;
    const t = this.ctx.currentTime;
    const ratio = Math.min(1, speed / Math.max(maxSpeed, 0.001));
    const windTarget = sliding ? 0.05 : ratio * ratio * 0.15;
    this.windGain.gain.setTargetAtTime(windTarget, t, 0.12);
    if (this.windFilter) this.windFilter.frequency.setTargetAtTime(500 + ratio * 900, t, 0.15);
    this.slideGain.gain.setTargetAtTime(sliding ? 0.16 : 0, t, 0.06);
    if (this.slideFilter) this.slideFilter.frequency.setTargetAtTime(sliding ? 1800 : 600, t, 0.1);
  }
}
