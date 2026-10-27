/**
 * AudioManager — lightweight Web Audio synthesis for movement feedback:
 * footsteps, jump, land, slide loop, sprint wind, checkpoint chime, finish
 * fanfare and UI clicks. No audio assets are downloaded.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private slideGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windPhase = Math.random() * 10;
  private slideActive = false;
  private lastFootstep = 0;
  private stepIdx = 0;

  /** Call on a user gesture (Start button). */
  init(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    // noise buffer (2 s)
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.buildSlides();
    this.buildWind();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  // ------------------------------------------------------------- loops

  private buildSlides(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    this.slideGain = gain;
  }

  private buildWind(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.55;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    this.windGain = gain;
    this.windFilter = filter;
  }

  // ------------------------------------------------------------- one-shots

  private noiseBurst(
    freq: number, q: number, duration: number,
    gainValue: number, type: BiquadFilterType = 'bandpass',
    freqEnd?: number
  ): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, now);
    filter.Q.value = q;
    if (freqEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + duration);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + duration + 0.05);
  }

  private tone(freq: number, duration: number, gainValue: number, type: OscillatorType = 'sine', delay = 0, freqEnd?: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  /** Footstep rhythm is driven by the camera bob. */
  footstep(now: number, sprinting: boolean): void {
    const minInterval = sprinting ? 0.26 : 0.34;
    if (now - this.lastFootstep < minInterval) return;
    this.lastFootstep = now;
    this.stepIdx = (this.stepIdx + 1) % 2;
    const base = 460 + this.stepIdx * 90 + (sprinting ? 160 : 0);
    this.noiseBurst(base, 1.6, 0.09, 0.30 + (sprinting ? 0.07 : 0));
    this.tone(72 + this.stepIdx * 6, 0.05, 0.14, 'sine');
  }

  jump(): void {
    this.noiseBurst(500, 1.1, 0.16, 0.16, 'bandpass', 1200);
    this.tone(150, 0.12, 0.07, 'sine', 0, 260);
  }

  land(impact: number): void {
    const k = Math.min(1, impact / 18);
    this.noiseBurst(160, 0.8, 0.14 + k * 0.06, 0.22 + k * 0.3);
    this.tone(58, 0.09, 0.2 + 0.18 * k, 'sine', 0, 40);
  }

  slideStart(): void {
    this.slideActive = true;
  }

  slideEnd(): void {
    this.slideActive = false;
  }

  vault(): void {
    this.noiseBurst(700, 1.4, 0.2, 0.14, 'bandpass', 1500);
  }

  mantle(): void {
    this.noiseBurst(420, 1.6, 0.18, 0.14, 'bandpass', 900);
  }

  headBump(): void {
    this.tone(90, 0.07, 0.16, 'triangle', 0, 55);
  }

  respawn(): void {
    this.noiseBurst(900, 1.0, 0.3, 0.12, 'bandpass', 260);
    this.tone(500, 0.22, 0.06, 'sine', 0, 240);
  }

  checkpoint(): void {
    this.tone(660, 0.14, 0.20, 'triangle');
    this.tone(990, 0.20, 0.18, 'triangle', 0.09);
  }

  finish(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone(f, 0.32, 0.16, 'triangle', i * 0.13));
    this.tone(1318.5, 0.6, 0.10, 'triangle', 4 * 0.13);
    this.noiseBurst(600, 0.7, 0.9, 0.06, 'bandpass', 2400);
  }

  uiClick(): void {
    this.tone(1250, 0.045, 0.10, 'square');
  }

  // ------------------------------------------------------------- per-frame

  update(dt: number, speed: number, sliding: boolean, wallrunning: boolean): void {
    if (!this.ctx || !this.windGain) return;
    // sprint wind
    this.windPhase += dt * 2.4;
    const windTarget = Math.pow(Math.max(0, Math.min(1, (speed - 6.5) / 5.5)), 1.4) * 0.55
      + (wallrunning ? 0.22 : 0);
    this.windGain.gain.setTargetAtTime(windTarget * (0.85 + Math.sin(this.windPhase) * 0.15), this.ctx.currentTime, 0.12);
    if (this.windFilter) {
      this.windFilter.frequency.setTargetAtTime(380 + speed * 26, this.ctx.currentTime, 0.2);
    }
    // slide loop
    if (this.slideGain) {
      const target = this.slideActive && sliding ? 0.34 : 0;
      this.slideGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
    }
  }
}
