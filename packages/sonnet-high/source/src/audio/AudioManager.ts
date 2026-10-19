/**
 * Procedural sound effects (Web Audio API). Nothing is downloaded: footsteps, jumps, landings,
 * slide scrape, wind, checkpoint chime and the completion fanfare are synthesised from noise
 * buffers, filters and oscillators.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private slideGain!: GainNode;
  private slideFilter!: BiquadFilterNode;
  private volume = 0.7;

  /** Must be called from a user gesture (the Start button). Safe to call repeatedly. */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // 2 s of white noise, looped for continuous layers and sliced for one-shots.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Wind: looped noise through a speed-controlled low-pass.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.master);

    // Slide: looped noise through a band-pass.
    this.slideFilter = ctx.createBiquadFilter();
    this.slideFilter.type = 'bandpass';
    this.slideFilter.frequency.value = 900;
    this.slideFilter.Q.value = 0.8;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    this.loopNoise().connect(this.slideFilter).connect(this.slideGain).connect(this.master);

    void ctx.resume();
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random());
    return src;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** Mutes the continuous layers (pause / menus). */
  silence(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0, t, 0.05);
    this.slideGain.gain.setTargetAtTime(0, t, 0.05);
  }

  /** Per-frame update of the continuous layers. */
  update(speed: number, sliding: boolean, airborne: boolean, wallRunning: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(Math.max((speed - 3.5) / 8, 0), 1);
    const air = airborne || wallRunning ? 1 : 0.55;
    this.windGain.gain.setTargetAtTime(Math.pow(s, 1.4) * 0.2 * air, t, 0.12);
    this.windFilter.frequency.setTargetAtTime(350 + speed * 170, t, 0.15);
    this.slideGain.gain.setTargetAtTime(sliding ? 0.12 + Math.min(speed / 12, 1) * 0.1 : 0, t, sliding ? 0.04 : 0.09);
    this.slideFilter.frequency.setTargetAtTime(700 + speed * 90, t, 0.1);
  }

  // ------------------------------------------------------------------------------------------
  // One-shots
  // ------------------------------------------------------------------------------------------

  private burst(opts: {
    type: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
    gain: number;
    attack: number;
    decay: number;
    delay?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.attack + opts.decay);
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + opts.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.attack + opts.decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, opts.attack + opts.decay + 0.05);
  }

  private tone(freq: number, freqEnd: number, gain: number, dur: number, type: OscillatorType = 'sine', delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd !== freq) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  footstep(speed: number, wall: boolean): void {
    const v = 0.55 + Math.min(speed / 10, 1) * 0.45;
    const j = 0.9 + Math.random() * 0.25;
    if (wall) {
      this.burst({ type: 'bandpass', freq: 2600 * j, q: 1.2, gain: 0.16 * v, attack: 0.004, decay: 0.08 });
      this.tone(160, 90, 0.1 * v, 0.07, 'triangle');
      return;
    }
    this.burst({ type: 'bandpass', freq: 1500 * j, q: 0.9, gain: 0.2 * v, attack: 0.004, decay: 0.07 });
    this.tone(120 * j, 55, 0.22 * v, 0.09);
  }

  jump(): void {
    this.burst({ type: 'bandpass', freq: 450, freqEnd: 1700, q: 0.7, gain: 0.12, attack: 0.02, decay: 0.16 });
    this.tone(140, 70, 0.14, 0.1);
  }

  land(impact: number): void {
    const v = Math.min(impact / 22, 1);
    if (impact < 3) return;
    this.tone(95, 38, 0.15 + 0.5 * v, 0.2 + 0.1 * v);
    this.burst({ type: 'lowpass', freq: 900, freqEnd: 250, gain: 0.12 + 0.3 * v, attack: 0.004, decay: 0.12 + 0.1 * v });
  }

  slideStart(): void {
    this.burst({ type: 'bandpass', freq: 1200, freqEnd: 500, q: 0.6, gain: 0.18, attack: 0.01, decay: 0.2 });
  }

  vault(): void {
    this.burst({ type: 'bandpass', freq: 600, freqEnd: 1500, q: 0.6, gain: 0.14, attack: 0.04, decay: 0.2 });
    this.tone(110, 60, 0.2, 0.12, 'sine', 0.22);
  }

  mantle(): void {
    this.burst({ type: 'bandpass', freq: 500, freqEnd: 1100, q: 0.7, gain: 0.12, attack: 0.05, decay: 0.2 });
    this.tone(100, 55, 0.22, 0.14, 'sine', 0.3);
  }

  wallStart(): void {
    this.burst({ type: 'highpass', freq: 1800, q: 0.7, gain: 0.14, attack: 0.01, decay: 0.12 });
  }

  wallJump(): void {
    this.burst({ type: 'bandpass', freq: 900, freqEnd: 2200, q: 0.7, gain: 0.14, attack: 0.01, decay: 0.15 });
    this.tone(150, 80, 0.14, 0.1);
  }

  checkpoint(): void {
    this.tone(659.25, 659.25, 0.22, 0.28, 'triangle');
    this.tone(987.77, 987.77, 0.22, 0.45, 'triangle', 0.11);
    this.tone(1318.5, 1318.5, 0.1, 0.5, 'sine', 0.22);
  }

  respawn(): void {
    this.burst({ type: 'lowpass', freq: 2200, freqEnd: 200, gain: 0.25, attack: 0.02, decay: 0.45 });
  }

  complete(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.tone(f, f, 0.2, 0.7, 'triangle', i * 0.12);
      this.tone(f * 2, f * 2, 0.06, 0.6, 'sine', i * 0.12);
    });
    this.tone(1046.5, 1046.5, 0.18, 1.4, 'triangle', 0.55);
    this.tone(1318.5, 1318.5, 0.14, 1.4, 'triangle', 0.55);
    this.tone(1568, 1568, 0.12, 1.4, 'triangle', 0.55);
  }
}
