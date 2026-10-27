import type { MovementEvent } from '../player/PlayerController';

export class AudioManager {
  enabled = true;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private stepTimer = 0;

  start(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    try {
      const context = new AudioContext();
      this.context = context;
      this.master = context.createGain();
      this.master.gain.value = this.enabled ? 0.32 : 0;
      this.master.connect(context.destination);
      this.noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const samples = this.noiseBuffer.getChannelData(0);
      for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
      const noise = context.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 450;
      this.wind = context.createGain();
      this.wind.gain.value = 0;
      noise.connect(filter).connect(this.wind).connect(this.master);
      noise.start();
    } catch {
      this.context = null;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master && this.context) this.master.gain.setTargetAtTime(enabled ? 0.32 : 0, this.context.currentTime, 0.05);
  }

  update(dt: number, speed: number, grounded: boolean, sliding: boolean, active: boolean): void {
    if (!this.context || !this.wind) return;
    const windLevel = active ? Math.max(0, (speed - 5) / 10) * 0.035 + (sliding ? 0.045 : 0) : 0;
    this.wind.gain.setTargetAtTime(windLevel, this.context.currentTime, 0.12);
    this.stepTimer -= dt;
    if (active && grounded && !sliding && speed > 2 && this.stepTimer <= 0) {
      this.noise(0.045, 0.065 + speed * 0.004, 280);
      this.stepTimer = Math.max(0.25, 0.49 - speed * 0.018);
    }
  }

  movement(event: MovementEvent): void {
    if (event === 'jump') this.tone(180, 110, 0.1, 0.065);
    if (event === 'land') this.noise(0.12, 0.18, 190);
    if (event === 'slide') this.noise(0.2, 0.1, 500);
    if (event === 'wallrun') this.tone(260, 360, 0.12, 0.045);
    if (event === 'vault' || event === 'mantle') this.noise(0.12, 0.1, 650);
  }

  checkpoint(): void {
    this.tone(520, 690, 0.12, 0.08);
    this.tone(780, 950, 0.16, 0.06, 0.09);
  }

  finish(): void {
    this.tone(440, 550, 0.2, 0.09);
    this.tone(660, 830, 0.24, 0.08, 0.12);
    this.tone(880, 1100, 0.35, 0.08, 0.25);
  }

  private tone(from: number, to: number, duration: number, volume: number, delay = 0): void {
    if (!this.context || !this.master) return;
    const time = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(from, time);
    oscillator.frequency.exponentialRampToValueAtTime(to, time + duration);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(time);
    oscillator.stop(time + duration);
  }

  private noise(duration: number, volume: number, frequency: number): void {
    if (!this.context || !this.master || !this.noiseBuffer) return;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(volume, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    source.stop(this.context.currentTime + duration);
  }
}
