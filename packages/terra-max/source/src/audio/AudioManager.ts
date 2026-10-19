/** Lightweight synthesized movement feedback; no downloaded assets required. */
export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastFootstep = 0;

  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  jump(): void {
    this.tone(170, 310, 0.075, 'triangle', 0.055);
  }

  land(hard: boolean): void {
    this.tone(hard ? 84 : 112, hard ? 56 : 86, hard ? 0.12 : 0.075, 'sine', hard ? 0.09 : 0.055);
  }

  slide(): void {
    this.tone(96, 54, 0.34, 'square', 0.035);
  }

  vault(): void {
    this.tone(280, 440, 0.11, 'triangle', 0.045);
  }

  checkpoint(): void {
    this.tone(440, 660, 0.12, 'sine', 0.075);
    window.setTimeout(() => this.tone(660, 880, 0.11, 'sine', 0.055), 92);
  }

  complete(): void {
    this.tone(330, 620, 0.23, 'triangle', 0.09);
    window.setTimeout(() => this.tone(495, 860, 0.34, 'triangle', 0.085), 175);
  }

  step(speed: number, grounded: boolean): void {
    if (!grounded || speed < 2.5 || !this.context) return;
    const now = performance.now();
    const cadence = Math.max(125, 330 - speed * 13);
    if (now - this.lastFootstep < cadence) return;
    this.lastFootstep = now;
    this.tone(92, 63, 0.032, 'sine', 0.03);
  }

  private tone(start: number, end: number, duration: number, type: OscillatorType, gain: number): void {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(start, this.context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, end), this.context.currentTime + duration);
    envelope.gain.setValueAtTime(0.0001, this.context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(gain, this.context.currentTime + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.start();
    oscillator.stop(this.context.currentTime + duration + 0.03);
  }
}
