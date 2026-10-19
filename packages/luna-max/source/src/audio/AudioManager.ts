export class AudioManager {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private windGain: GainNode | undefined;

  unlock(): void {
    if (this.context) {
      if (this.context.state === "suspended") void this.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    try {
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.36;
      this.master.connect(this.context.destination);
      this.startWindBed();
    } catch {
      this.context = undefined;
    }
  }

  private startWindBed(): void {
    if (!this.context || !this.master) return;
    const context = this.context;
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.35;
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 520;
    this.windGain = context.createGain();
    this.windGain.gain.value = 0;
    noise.connect(filter).connect(this.windGain).connect(this.master);
    noise.start();
  }

  private tone(frequency: number, duration: number, volume: number, type: OscillatorType = "sine", endFrequency?: number): void {
    if (!this.context || !this.master) return;
    const context = this.context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), context.currentTime + duration);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), context.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.02);
  }

  footstep(speed: number): void {
    const pitch = 88 + Math.min(speed, 15) * 3.5;
    this.tone(pitch, 0.055, 0.045, "triangle", pitch * 0.72);
  }

  jump(): void {
    this.tone(210, 0.13, 0.055, "sine", 390);
  }

  land(impact: number): void {
    this.tone(95, 0.12, Math.min(0.12, 0.035 + impact * 0.003), "triangle", 54);
  }

  vault(): void {
    this.tone(310, 0.17, 0.06, "triangle", 540);
  }

  checkpoint(): void {
    this.tone(520, 0.2, 0.07, "sine");
    window.setTimeout(() => this.tone(780, 0.24, 0.06, "sine"), 90);
  }

  finish(): void {
    this.tone(440, 0.34, 0.07, "sine");
    window.setTimeout(() => this.tone(660, 0.34, 0.07, "sine"), 110);
    window.setTimeout(() => this.tone(880, 0.5, 0.06, "sine"), 220);
  }

  setWind(amount: number): void {
    if (!this.context || !this.windGain) return;
    const target = Math.max(0, Math.min(0.11, amount * 0.14));
    this.windGain.gain.setTargetAtTime(target, this.context.currentTime, 0.18);
  }

  dispose(): void {
    if (!this.context) return;
    this.setWind(0);
    void this.context.close();
    this.context = undefined;
    this.master = undefined;
    this.windGain = undefined;
  }
}

