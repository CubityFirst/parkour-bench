/**
 * Tiny Web Audio synth: every sound is generated from noise bursts and oscillators
 * (no audio files). Must be initialised from a user gesture.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private wind?: { gain: GainNode; filter: BiquadFilterNode };
  private slide?: { gain: GainNode; filter: BiquadFilterNode };
  private wall?: { gain: GainNode; filter: BiquadFilterNode };
  volume = 0.7;

  init(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // 2 s of white noise, looped for continuous sounds
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.wind = this.loop('bandpass', 500, 0.6);
    this.slide = this.loop('bandpass', 1400, 1.2);
    this.wall = this.loop('bandpass', 900, 2.5);
  }

  private loop(type: BiquadFilterType, freq: number, q: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    return { gain, filter };
  }

  private burst(type: BiquadFilterType, freq: number, q: number, dur: number, vol: number, freqEnd?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random(), dur + 0.05);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0, freqEnd?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  footstep(sprinting: boolean): void {
    this.burst('lowpass', sprinting ? 900 : 650, 0.7, 0.07, sprinting ? 0.22 : 0.14);
  }

  jump(): void {
    this.burst('bandpass', 500, 1, 0.14, 0.18, 1400);
    this.tone(180, 0.1, 0.05, 'sine', 0, 120);
  }

  land(impact: number): void {
    if (impact < 3) return;
    const v = Math.min(0.6, 0.12 + impact * 0.025);
    this.burst('lowpass', 420, 0.8, 0.18, v);
    this.tone(90, 0.16, v * 0.5, 'sine', 0, 50);
  }

  vault(): void {
    this.burst('bandpass', 700, 0.8, 0.22, 0.16, 300);
  }

  wallJump(): void {
    this.burst('bandpass', 900, 1.2, 0.12, 0.2, 2000);
  }

  checkpoint(): void {
    this.tone(660, 0.18, 0.18, 'sine');
    this.tone(990, 0.28, 0.18, 'sine', 0.1);
  }

  finish(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.55, 0.2, 'triangle', i * 0.12));
    this.tone(262, 1.2, 0.15, 'sine', 0.45);
  }

  respawn(): void {
    this.tone(300, 0.25, 0.12, 'sine', 0, 120);
  }

  /** Continuous layers, called every frame. */
  setLoops(speed: number, sliding: boolean, wallRunning: boolean, airborne: boolean): void {
    if (!this.ctx || !this.wind || !this.slide || !this.wall) return;
    const t = this.ctx.currentTime;
    const sp = Math.min(1, Math.max(0, (speed - 3) / 9));
    const windVol = sp * sp * 0.22 * (airborne ? 1.3 : 0.8);
    this.wind.gain.gain.setTargetAtTime(windVol, t, 0.1);
    this.wind.filter.frequency.setTargetAtTime(350 + sp * 1400, t, 0.1);
    this.slide.gain.gain.setTargetAtTime(sliding ? 0.2 * Math.min(1, speed / 8) : 0, t, 0.05);
    this.slide.filter.frequency.setTargetAtTime(900 + speed * 90, t, 0.1);
    this.wall.gain.gain.setTargetAtTime(wallRunning ? 0.14 : 0, t, 0.05);
  }

  silenceLoops(): void {
    if (!this.ctx || !this.wind || !this.slide || !this.wall) return;
    const t = this.ctx.currentTime;
    this.wind.gain.gain.setTargetAtTime(0, t, 0.05);
    this.slide.gain.gain.setTargetAtTime(0, t, 0.05);
    this.wall.gain.gain.setTargetAtTime(0, t, 0.05);
  }
}
