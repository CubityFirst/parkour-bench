export class AudioManager {
  private context: AudioContext | null = null;

  enable(): void {
    if (!this.context) this.context = new AudioContext();
    void this.context.resume();
  }

  private tone(freq: number, duration: number, volume: number, type: OscillatorType = 'sine', slide = 0): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(this.context.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  jump(): void { this.tone(270, 0.1, 0.05, 'triangle', 180); }
  land(): void { this.tone(115, 0.11, 0.07, 'square', -55); }
  slide(): void { this.tone(150, 0.3, 0.025, 'sawtooth', -80); }
  checkpoint(): void { this.tone(560, 0.12, 0.06, 'sine', 220); setTimeout(() => this.tone(780, 0.14, 0.05, 'sine'), 85); }
  complete(): void {
    [0, 120, 240].forEach((delay, index) => setTimeout(() => this.tone(440 + index * 150, 0.25, 0.08, 'triangle', 110), delay));
  }
}
