/** Tiny Web Audio synth: every sound is generated from noise/oscillators, no assets. */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private slideGain!: GainNode;

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.windGain = this.loop(500, 0.45);
    this.slideGain = this.loop(1800, 1.2);
  }

  private loop(freq: number, q: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    return g;
  }

  private burst(freq: number, q: number, dur: number, vol: number, type: BiquadFilterType = 'bandpass', endFreq?: number): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, vol: number, when = 0, type: OscillatorType = 'sine', endFreq?: number): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  footstep(sprint: boolean): void { this.burst(sprint ? 260 : 200, 1.2, 0.08, sprint ? 0.5 : 0.35, 'lowpass'); }
  jump(): void { this.burst(700, 0.8, 0.14, 0.25, 'bandpass', 1600); }
  land(impact: number): void {
    const v = Math.min(1, impact / 18);
    this.burst(180, 0.8, 0.18, 0.3 + v * 0.6, 'lowpass');
    this.tone(70, 0.15, 0.2 * v, 0, 'sine', 40);
  }
  mantle(): void { this.burst(400, 0.7, 0.25, 0.3, 'bandpass', 900); }
  setSlide(on: boolean): void {
    if (!this.ctx) return;
    this.slideGain.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.06);
  }
  setWind(speed: number): void {
    if (!this.ctx) return;
    const v = Math.max(0, (speed - 5) / 8);
    this.windGain.gain.setTargetAtTime(Math.min(1, v) * 0.2, this.ctx.currentTime, 0.2);
  }
  checkpoint(): void { this.tone(660, 0.25, 0.25); this.tone(990, 0.4, 0.22, 0.12); }
  respawn(): void { this.burst(900, 0.5, 0.4, 0.3, 'lowpass', 120); }
  finish(): void { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.55, 0.22, i * 0.13, 'triangle')); }
}
