/**
 * Procedural sound effects built with the Web Audio API. No audio files are
 * loaded. The context is created lazily, on the first user gesture, to satisfy
 * browser autoplay rules.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private distanceSinceStep = 0;
  private stepSide = 0;

  /** Set to false to silence everything (the settings menu can expose this later). */
  enabled = true;

  /** Creates or resumes the audio context. Call from a click or key handler. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoiseBuffer(this.ctx, 1.0);
      this.startWind();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Per-frame ambience and footsteps. `speed` is horizontal m/s. */
  update(dt: number, speed: number, grounded: boolean, sprinting: boolean): void {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    // Wind builds with speed, brighter when sprinting.
    const windT = Math.max(0, Math.min(1, (speed - 6) / 6));
    this.windGain.gain.setTargetAtTime(this.enabled ? windT * 0.12 : 0, this.ctx.currentTime, 0.2);
    this.windFilter.frequency.setTargetAtTime(sprinting ? 1400 : 700, this.ctx.currentTime, 0.2);

    if (grounded && speed > 2) {
      this.distanceSinceStep += speed * dt;
      const stride = sprinting ? 2.6 : 1.9;
      if (this.distanceSinceStep >= stride) {
        this.distanceSinceStep = 0;
        this.stepSide = 1 - this.stepSide;
        this.footstep(this.stepSide === 0 ? 1 : 0.85);
      }
    } else {
      this.distanceSinceStep = 0;
    }
  }

  jump(): void {
    this.tone(260, 520, 0.18, 'sine', 0.22);
  }

  land(impact: number): void {
    const v = Math.min(1, impact / 18);
    if (v < 0.08) return;
    this.noiseBurst(0.12 + v * 0.1, 400 + (1 - v) * 300, 0.25 + v * 0.35);
    this.tone(120, 60, 0.14, 'sine', 0.2 * v + 0.05);
  }

  slide(): void {
    this.noiseBurst(0.45, 1100, 0.18, 'bandpass', 2);
  }

  wallRun(): void {
    this.noiseBurst(0.35, 2000, 0.16, 'highpass', 1);
  }

  wallJump(): void {
    this.tone(340, 680, 0.14, 'triangle', 0.18);
  }

  vault(): void {
    this.noiseBurst(0.12, 900, 0.12, 'bandpass', 1.2);
    this.tone(200, 300, 0.1, 'triangle', 0.12);
  }

  mantle(): void {
    this.noiseBurst(0.18, 700, 0.14, 'bandpass', 1);
    this.tone(180, 260, 0.14, 'triangle', 0.12);
  }

  checkpoint(): void {
    this.tone(660, 660, 0.12, 'sine', 0.2);
    window.setTimeout(() => this.tone(880, 880, 0.18, 'sine', 0.2), 110);
  }

  complete(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      window.setTimeout(() => this.tone(f, f, 0.5, 'triangle', 0.22), i * 130);
    });
  }

  // ----------------------------------------------------------- internals

  private footstep(volume: number): void {
    this.noiseBurst(0.06, 600, 0.12 * volume, 'lowpass', 1);
  }

  private tone(from: number, to: number, duration: number, type: OscillatorType, volume: number): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private noiseBurst(duration: number, freq: number, volume: number, filterType: BiquadFilterType = 'lowpass', q = 0.7): void {
    if (!this.ctx || !this.master || !this.noiseBuffer || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration + 0.02);
  }

  private startWind(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.6;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
  }

  private makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
