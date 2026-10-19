export class AudioManager {
  enabled = true;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: GainNode | null = null;
  private stepTime = 0;
  private noise: AudioBuffer | null = null;

  async start(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.enabled ? 0.35 : 0;
      this.master.connect(this.context.destination);
      this.noise = this.context.createBuffer(
        1,
        this.context.sampleRate * 2,
        this.context.sampleRate,
      );
      const samples = this.noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] = Math.random() * 2 - 1;
      const source = this.context.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 500;
      this.wind = this.context.createGain();
      this.wind.gain.value = 0;
      source.connect(filter);
      filter.connect(this.wind);
      this.wind.connect(this.master);
      source.start();
    }
    await this.context.resume();
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        this.enabled ? 0.35 : 0,
        this.context.currentTime,
        0.06,
      );
    return this.enabled;
  }

  private tone(
    frequency: number,
    duration: number,
    volume = 0.16,
    delay = 0,
  ): void {
    if (!this.context || !this.master) return;
    const t = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator(),
      gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(t);
    oscillator.stop(t + duration + 0.02);
  }

  private impact(volume: number, length: number, frequency: number): void {
    if (!this.context || !this.master || !this.noise) return;
    const t = this.context.currentTime;
    const source = this.context.createBufferSource(),
      filter = this.context.createBiquadFilter(),
      gain = this.context.createGain();
    source.buffer = this.noise;
    source.playbackRate.value = 0.85 + Math.random() * 0.3;
    filter.type = "lowpass";
    filter.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + length);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
    source.stop(t + length);
  }

  event(name: string, intensity = 1): void {
    if (name === "jump") this.impact(0.11, 0.14, 900);
    if (name === "land") {
      this.impact(0.2 * intensity, 0.16, 420);
      this.tone(85, 0.11, 0.07 * intensity);
    }
    if (name === "slide") this.impact(0.16, 0.7, 1400);
    if (name === "vault") this.impact(0.13, 0.15, 800);
    if (name === "wallrun") this.impact(0.12, 0.3, 700);
    if (name === "checkpoint") {
      this.tone(523, 0.2, 0.12);
      this.tone(784, 0.35, 0.1, 0.11);
    }
    if (name === "finish")
      [523, 659, 784, 1046].forEach((f, i) =>
        this.tone(f, 0.55, 0.16, i * 0.13),
      );
  }

  update(
    dt: number,
    speed: number,
    grounded: boolean,
    sliding: boolean,
    playing: boolean,
  ): void {
    if (!this.context) return;
    this.wind?.gain.setTargetAtTime(
      playing ? Math.max(0, speed - 3) * 0.009 : 0,
      this.context.currentTime,
      0.15,
    );
    if (!playing || !grounded || sliding || speed < 2) {
      this.stepTime = 0;
      return;
    }
    this.stepTime += dt;
    if (this.stepTime > Math.max(0.23, 0.48 - speed * 0.015)) {
      this.stepTime = 0;
      this.impact(0.12, 0.075, 420 + Math.random() * 250);
      this.tone(90, 0.065, 0.035);
    }
  }
}
