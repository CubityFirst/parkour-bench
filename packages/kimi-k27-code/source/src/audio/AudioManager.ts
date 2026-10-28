export class AudioManager {
  ctx: AudioContext | null = null;
  enabled = true;

  private windNode: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windOsc: AudioBufferSourceNode | null = null;

  init() {
    if (this.ctx) return;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled && this.ctx) {
      this.ctx.suspend();
    } else if (enabled && this.ctx) {
      this.ctx.resume();
    }
  }

  private now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private noiseBuffer(duration: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  playTone(freq: number, duration: number, type: OscillatorType, volume = 0.3, fade = 0.02) {
    if (!this.enabled || !this.ctx) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + fade);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration + fade);
  }

  playNoise(duration: number, volume = 0.3, freq = 1000) {
    if (!this.enabled || !this.ctx) return;
    const buffer = this.noiseBuffer(duration);
    if (!buffer) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t);
  }

  footstep() {
    this.playNoise(0.12, 0.25, 800);
  }

  jump() {
    this.playTone(220, 0.25, 'sine', 0.25, 0.03);
  }

  land() {
    this.playNoise(0.18, 0.35, 600);
  }

  slide() {
    this.playNoise(0.6, 0.2, 400);
  }

  checkpoint() {
    this.playTone(880, 0.25, 'sine', 0.25);
    setTimeout(() => this.playTone(1760, 0.4, 'sine', 0.2), 120);
  }

  finish() {
    this.playTone(523, 0.3, 'square', 0.15);
    setTimeout(() => this.playTone(659, 0.3, 'square', 0.15), 150);
    setTimeout(() => this.playTone(784, 0.5, 'square', 0.15), 300);
    setTimeout(() => this.playTone(1047, 0.8, 'square', 0.15), 500);
  }

  updateWind(speed: number, grounded: boolean) {
    if (!this.enabled || !this.ctx) return;
    const target = grounded ? Math.min(0.05, speed * 0.005) : Math.min(0.18, 0.08 + speed * 0.008);
    if (!this.windNode) {
      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 400;
      this.windFilter.Q.value = 0.5;
      this.windNode = this.ctx.createGain();
      this.windNode.gain.value = 0;
      const buffer = this.noiseBuffer(2);
      if (buffer) {
        this.windOsc = this.ctx.createBufferSource();
        this.windOsc.buffer = buffer;
        this.windOsc.loop = true;
        this.windOsc.connect(this.windFilter).connect(this.windNode).connect(this.ctx.destination);
        this.windOsc.start();
      }
    }
    if (this.windNode) {
      const t = this.now();
      this.windNode.gain.setTargetAtTime(target, t, 0.2);
    }
  }
}
