/**
 * Procedural sound effects built from oscillators and filtered noise, so no audio files are needed.
 * Nothing plays until `init()` runs from a user gesture (browsers require one for AudioContext).
 */
export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: GainNode | null = null;

  init(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }

    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Looping wind bed; its gain follows running speed
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 600;
    windFilter.Q.value = 0.5;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    const windSource = ctx.createBufferSource();
    windSource.buffer = noise;
    windSource.loop = true;
    windSource.connect(windFilter).connect(windGain).connect(master);
    windSource.start();

    this.context = ctx;
    this.master = master;
    this.noise = noise;
    this.wind = windGain;
  }

  setWind(speed: number): void {
    if (!this.context || !this.wind) return;
    const target = Math.min(1, Math.max(0, (speed - 9) / 7)) * 0.12;
    this.wind.gain.setTargetAtTime(target, this.context.currentTime, 0.25);
  }

  jump(): void {
    this.tone(230, 0.12, 'triangle', 0.14, 480);
  }

  land(strength: number): void {
    this.burst(0.14, 0.05 + 0.3 * strength, 320);
  }

  step(): void {
    this.burst(0.06, 0.07, 900);
  }

  slide(): void {
    this.burst(0.45, 0.18, 1400);
  }

  wallRun(): void {
    this.burst(0.35, 0.1, 2200);
  }

  vault(): void {
    this.tone(320, 0.12, 'sine', 0.1, 560);
  }

  checkpoint(): void {
    this.tone(660, 0.18, 'sine', 0.2);
    this.tone(990, 0.28, 'sine', 0.16, 990, 0.12);
  }

  complete(): void {
    [523, 659, 784, 1046].forEach((frequency, i) => {
      this.tone(frequency, 0.35, 'triangle', 0.2, frequency, i * 0.12);
    });
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    slideTo = frequency,
    delay = 0,
  ): void {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master) return;

    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  private burst(duration: number, volume: number, frequency: number): void {
    const ctx = this.context;
    const master = this.master;
    const noise = this.noise;
    if (!ctx || !master || !noise) return;

    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(now, Math.random() * 1.5);
    source.stop(now + duration + 0.05);
  }
}
