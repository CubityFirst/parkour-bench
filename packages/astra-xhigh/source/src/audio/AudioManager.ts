export class AudioManager {
  enabled = true;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: GainNode | null = null;
  private stepTimer = 0;
  init() {
    if (this.context) {
      void this.context.resume();
      return;
    }
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.enabled ? 0.24 : 0;
    this.master.connect(this.context.destination);
    const size = this.context.sampleRate * 2,
      buffer = this.context.createBuffer(1, size, this.context.sampleRate),
      data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * 0.4;
    const noise = this.context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 450;
    this.wind = this.context.createGain();
    this.wind.gain.value = 0;
    noise.connect(filter);
    filter.connect(this.wind);
    this.wind.connect(this.master);
    noise.start();
  }
  setEnabled(value: boolean) {
    this.enabled = value;
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        value ? 0.24 : 0,
        this.context.currentTime,
        0.1,
      );
  }
  tone(
    frequency: number,
    duration: number,
    volume = 0.2,
    type: OscillatorType = "sine",
    end?: number,
  ) {
    if (!this.context || !this.master) return;
    const t = this.context.currentTime;
    const osc = this.context.createOscillator(),
      gain = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (end) osc.frequency.exponentialRampToValueAtTime(end, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + duration);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
  event(kind: string) {
    if (kind === "jump") this.tone(200, 0.12, 0.12, "sine", 350);
    if (kind === "land") this.tone(95, 0.15, 0.45, "triangle", 35);
    if (kind === "vault") this.tone(150, 0.2, 0.13, "triangle", 280);
    if (kind === "slide") this.tone(160, 0.4, 0.1, "sawtooth", 45);
    if (kind === "wall") this.tone(260, 0.2, 0.1, "sine", 190);
    if (kind === "checkpoint") {
      this.tone(660, 0.2, 0.14);
      setTimeout(() => this.tone(880, 0.28, 0.12), 110);
    }
    if (kind === "finish") {
      [440, 554, 659, 880].forEach((f, i) =>
        setTimeout(() => this.tone(f, 0.7, 0.18), i * 120),
      );
    }
  }
  update(
    dt: number,
    speed: number,
    grounded: boolean,
    sliding: boolean,
    active: boolean,
  ) {
    if (this.wind && this.context)
      this.wind.gain.setTargetAtTime(
        active ? Math.max(0, (speed - 5) / 30) : 0,
        this.context.currentTime,
        0.15,
      );
    if (active && grounded && speed > 1 && !sliding) {
      this.stepTimer += dt;
      if (this.stepTimer > 2.6 / speed) {
        this.stepTimer = 0;
        this.tone(85 + Math.random() * 30, 0.055, 0.19, "triangle", 40);
      }
    }
  }
}
