/**
 * Synthesised sound effects. Every sound is generated with the Web Audio API from oscillators
 * and a shared noise buffer, so the game ships no audio files.
 */
export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: GainNode | null = null;
  private slideLoop: GainNode | null = null;
  private enabled = true;

  /**
   * Creates the audio graph. Browsers only allow audio after a user gesture, so call this from
   * the Start button handler.
   */
  unlock(): void {
    if (!this.context) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;

      const ctx = new Ctor();
      this.context = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.enabled ? 0.6 : 0;
      this.master.connect(ctx.destination);
      this.noise = this.createNoise(ctx);
      this.wind = this.loopNoise(ctx, 'bandpass', 700, 0.8, 0);
      this.slideLoop = this.loopNoise(ctx, 'lowpass', 900, 0.5, 0);
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(on ? 0.6 : 0, this.context.currentTime, 0.05);
    }
  }

  /** Wind volume follows speed. Called once per rendered frame. */
  update(speed: number): void {
    if (!this.context || !this.wind) return;
    const target = Math.min(1, Math.max(0, (speed - 6) / 5)) * 0.16;
    this.wind.gain.setTargetAtTime(target, this.context.currentTime, 0.2);
  }

  slide(active: boolean): void {
    if (!this.context || !this.slideLoop) return;
    this.slideLoop.gain.setTargetAtTime(active ? 0.16 : 0, this.context.currentTime, 0.06);
  }

  footstep(speed: number): void {
    if (!this.context) return;
    const gain = 0.05 + Math.min(0.06, speed * 0.006);
    this.burst(this.context, 'bandpass', 380 + Math.random() * 260, 0.07, gain);
  }

  jump(): void {
    if (!this.context) return;
    this.sweep(this.context, 'triangle', 220, 480, 0.16, 0.12);
  }

  land(impactSpeed: number): void {
    if (!this.context) return;
    const gain = Math.min(0.35, 0.05 + impactSpeed * 0.02);
    this.burst(this.context, 'lowpass', 260, 0.22, gain);
    this.sweep(this.context, 'sine', 120, 55, 0.2, gain * 0.8);
  }

  /** Air rush for wall runs, vaults and mantles. */
  whoosh(): void {
    if (!this.context) return;
    this.burst(this.context, 'bandpass', 500, 0.35, 0.14, 1800);
  }

  checkpoint(): void {
    if (!this.context) return;
    this.note(this.context, 660, 0, 0.3, 0.12);
    this.note(this.context, 990, 0.12, 0.35, 0.12);
  }

  /** A rising major arpeggio for completing the level. */
  complete(): void {
    const ctx = this.context;
    if (!ctx) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, i) => this.note(ctx, frequency, i * 0.14, 0.5, 0.12));
  }

  private createNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Continuous, looping noise through a filter. Returns the gain node so its level can be driven. */
  private loopNoise(
    ctx: AudioContext,
    type: BiquadFilterType,
    frequency: number,
    q: number,
    gain: number,
  ): GainNode {
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const level = ctx.createGain();
    level.gain.value = gain;
    source.connect(filter).connect(level);
    if (this.master) level.connect(this.master);
    source.start();
    return level;
  }

  private burst(
    ctx: AudioContext,
    type: BiquadFilterType,
    frequency: number,
    duration: number,
    gain: number,
    endFrequency?: number,
  ): void {
    if (!this.noise || !this.master) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, now);
    if (endFrequency) filter.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    filter.Q.value = 1.2;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(envelope).connect(this.master);
    source.start(now, Math.random() * 1.5, duration + 0.05);
  }

  private sweep(
    ctx: AudioContext,
    type: OscillatorType,
    from: number,
    to: number,
    duration: number,
    gain: number,
  ): void {
    if (!this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + duration);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(envelope).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  private note(ctx: AudioContext, frequency: number, delay: number, duration: number, gain: number): void {
    if (!this.master) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.02);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(envelope).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }
}
