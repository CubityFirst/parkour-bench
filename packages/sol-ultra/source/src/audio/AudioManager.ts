/** Small synthesized movement sounds: no downloaded assets or background music. */
export class AudioManager {
  enabled = true;
  private context?: AudioContext;
  private master?: GainNode;
  private wind?: GainNode;
  private stepDistance = 0;

  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.enabled ? 0.32 : 0;
      this.master.connect(this.context.destination);
      const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      const noise = this.context.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 650;
      this.wind = this.context.createGain();
      this.wind.gain.value = 0;
      noise.connect(filter).connect(this.wind).connect(this.master);
      noise.start();
    }
    await this.context.resume();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.master && this.context) this.master.gain.setTargetAtTime(enabled ? 0.32 : 0, this.context.currentTime, 0.06);
  }

  private tone(frequency: number, duration: number, volume: number, type: OscillatorType = 'sine', delay = 0, endFrequency?: number) {
    if (!this.context || !this.master || !this.enabled) return;
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  play(event: string) {
    if (event === 'jump') this.tone(160, 0.12, 0.13, 'sine', 0, 290);
    if (event === 'land') { this.tone(88, 0.14, 0.3, 'triangle', 0, 40); this.tone(190, 0.06, 0.07); }
    if (event === 'slide') this.tone(240, 0.4, 0.07, 'sawtooth', 0, 55);
    if (event === 'vault' || event === 'wallrun') this.tone(230, 0.14, 0.1, 'triangle', 0, 410);
    if (event === 'checkpoint') [440, 554.37, 659.25].forEach((f, i) => this.tone(f, 0.3, 0.1, 'sine', i * 0.08));
    if (event === 'finish') [392, 493.88, 587.33, 783.99].forEach((f, i) => this.tone(f, 0.55, 0.14, 'sine', i * 0.12));
  }

  update(dt: number, speed: number, grounded: boolean, sliding: boolean, active: boolean) {
    if (this.context && this.wind) this.wind.gain.setTargetAtTime(active ? Math.min(speed / 13, 1) * 0.09 : 0, this.context.currentTime, 0.2);
    if (!active || !grounded || sliding || speed < 1.5) { this.stepDistance = 0; return; }
    this.stepDistance += speed * dt;
    if (this.stepDistance > 2.6) {
      this.stepDistance = 0;
      this.tone(90 + Math.random() * 35, 0.065, 0.11, 'triangle', 0, 45);
    }
  }
}
