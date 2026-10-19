/**
 * Procedural sound effects built with the Web Audio API. Nothing is downloaded.
 * The AudioContext is created on the first user gesture (the Start button) to satisfy browser autoplay rules.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  enabled = true;

  /** Creates the audio graph. Safe to call more than once. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);

    // One second of white noise, reused for every noise-based effect.
    const length = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;

    this.startWind();
  }

  /** Mutes or unmutes all effects. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.6 : 0;
  }

  /** Continuous wind bed. `intensity` is 0..1, driven by sprint speed. */
  setWind(intensity: number): void {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.012 + intensity * 0.07, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(380 + intensity * 900, t, 0.2);
  }

  footstep(sprinting: boolean): void {
    this.noiseBurst(0.045, sprinting ? 900 : 650, 'bandpass', sprinting ? 0.1 : 0.06);
  }

  jump(): void {
    this.tone(260, 520, 0.16, 'sine', 0.12);
    this.noiseBurst(0.12, 1500, 'highpass', 0.03);
  }

  wallJump(): void {
    this.tone(360, 720, 0.14, 'triangle', 0.12);
  }

  /** Landing thump, scaled by how hard the landing was (0..1). */
  land(strength: number): void {
    if (strength <= 0.02) {
      this.noiseBurst(0.04, 500, 'lowpass', 0.03);
      return;
    }
    this.tone(120, 50, 0.2, 'sine', 0.25 * strength);
    this.noiseBurst(0.1, 350, 'lowpass', 0.15 * strength);
  }

  slide(): void {
    this.noiseBurst(0.45, 900, 'bandpass', 0.1);
  }

  wallRunStart(): void {
    this.noiseBurst(0.3, 2200, 'highpass', 0.06);
    this.tone(200, 300, 0.3, 'sawtooth', 0.02);
  }

  climb(kind: 'vault' | 'mantle'): void {
    if (kind === 'vault') {
      this.tone(300, 180, 0.12, 'triangle', 0.1);
    } else {
      this.tone(160, 260, 0.22, 'triangle', 0.1);
    }
  }

  checkpoint(): void {
    this.tone(660, 660, 0.12, 'sine', 0.14, 0);
    this.tone(880, 880, 0.18, 'sine', 0.14, 0.1);
  }

  finish(): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, f, 0.35, 'triangle', 0.16, i * 0.1));
  }

  // ---------------------------------------------------------------- helpers

  /** A short pitched tone with an exponential decay envelope. */
  private tone(
    startFreq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + duration);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(amp).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** A filtered burst of noise, used for footsteps, slides, wind gusts and impacts. */
  private noiseBurst(duration: number, frequency: number, filterType: BiquadFilterType, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || !this.enabled) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const amp = ctx.createGain();
    const t0 = ctx.currentTime;
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(amp).connect(this.master);
    src.start(t0, Math.random() * 0.5, duration + 0.05);
  }

  /** Looping filtered noise whose level follows the player's speed. */
  private startWind(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 380;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.012;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.windGain = gain;
    this.windFilter = filter;
  }
}
