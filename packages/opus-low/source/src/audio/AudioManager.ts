/** Procedural sound effects using the Web Audio API — no audio files. */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private slideGain!: GainNode;

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.windGain = this.loop(400, 'lowpass', 0.7);
    this.slideGain = this.loop(1400, 'bandpass', 1.2);
  }

  private loop(freq: number, type: BiquadFilterType, q: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return g;
  }

  private burst(freq: number, dur: number, vol: number, type: BiquadFilterType = 'lowpass') {
    const ctx = this.ctx; if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private tone(freq: number, dur: number, vol: number, delay = 0, type: OscillatorType = 'sine', endFreq?: number) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  footstep() { this.burst(500 + Math.random() * 300, 0.07, 0.35); this.tone(90, 0.06, 0.12); }
  jump() { this.burst(900, 0.12, 0.25, 'bandpass'); this.tone(140, 0.1, 0.1, 0, 'sine', 220); }
  land(intensity: number) {
    const k = Math.min(1, intensity / 15);
    this.burst(350, 0.15 + k * 0.1, 0.3 + k * 0.4);
    this.tone(80, 0.18, 0.2 + k * 0.3, 0, 'sine', 40);
  }
  vault() { this.burst(1200, 0.15, 0.25, 'bandpass'); }
  checkpoint() { this.tone(660, 0.18, 0.25); this.tone(990, 0.3, 0.25, 0.12); }
  finish() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.5, 0.22, i * 0.12, 'triangle')); }

  /** Continuous layers: wind by speed, scrape while sliding. */
  setContinuous(speed: number, sliding: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const wind = Math.max(0, (speed - 5) / 8) * 0.35;
    this.windGain.gain.setTargetAtTime(wind, t, 0.2);
    this.slideGain.gain.setTargetAtTime(sliding ? 0.25 : 0, t, 0.05);
  }

  silence() { this.setContinuous(0, false); }
}
