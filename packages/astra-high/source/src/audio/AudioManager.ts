export class AudioManager {
  enabled = localStorage.getItem('upshift-sound') !== 'off';
  private context?: AudioContext;
  private master?: GainNode;
  private wind?: GainNode;
  private noiseBuffer?: AudioBuffer;
  private stepTimer = 0;
  init() {
    if (this.context) { void this.context.resume(); return; }
    this.context = new AudioContext();
    this.master = this.context.createGain(); this.master.gain.value = this.enabled ? 0.32 : 0; this.master.connect(this.context.destination);
    const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    const source = this.context.createBufferSource(); source.buffer = buffer; source.loop = true;
    const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 430;
    this.wind = this.context.createGain(); this.wind.gain.value = 0;
    source.connect(filter); filter.connect(this.wind); this.wind.connect(this.master); source.start();
  }
  toggle() { this.enabled = !this.enabled; localStorage.setItem('upshift-sound', this.enabled ? 'on' : 'off'); if (this.master) this.master.gain.value = this.enabled ? 0.32 : 0; }
  tone(frequency: number, duration: number, volume = 0.15, delay = 0) {
    if (!this.context || !this.master) return;
    const at = this.context.currentTime + delay;
    const osc = this.context.createOscillator(), gain = this.context.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(frequency, at); osc.frequency.exponentialRampToValueAtTime(frequency * 0.65, at + duration);
    gain.gain.setValueAtTime(volume, at); gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    osc.connect(gain); gain.connect(this.master); osc.start(at); osc.stop(at + duration);
  }
  noise(duration: number, volume: number, frequency: number) {
    if (!this.context || !this.master || !this.noiseBuffer) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource(); source.buffer = this.noiseBuffer;
    const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = frequency;
    const gain = this.context.createGain(); gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start(); source.stop(now + duration);
  }
  play(event: string) {
    if (event === 'jump') this.noise(0.13, 0.11, 1400);
    if (event === 'land') { this.tone(95, 0.12, 0.3); this.noise(0.1, 0.26, 650); }
    if (event === 'slide') this.noise(0.8, 0.21, 1800);
    if (event === 'vault') this.noise(0.15, 0.16, 800);
    if (event === 'wallrun') this.noise(0.25, 0.12, 1000);
    if (event === 'checkpoint') { this.tone(660, 0.18, 0.12); this.tone(990, 0.3, 0.1, 0.1); }
    if (event === 'finish') [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.6, 0.16, i * 0.15));
  }
  update(dt: number, speed: number, grounded: boolean, sliding: boolean, active: boolean) {
    if (this.wind && this.context) this.wind.gain.setTargetAtTime(active ? Math.max(0.008, (speed - 4) / 100) : 0, this.context.currentTime, 0.15);
    if (!active || !grounded || speed < 1 || sliding) { this.stepTimer = 0; return; }
    this.stepTimer += dt * speed;
    if (this.stepTimer > 2.5) { this.stepTimer = 0; this.noise(0.055, 0.12, 600); this.tone(90 + Math.random() * 25, 0.065, 0.15); }
  }
}
