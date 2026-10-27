export class AudioManager {
  private context: AudioContext | null = null;
  private lastStep = 0;
  private lastWind = 0;
  private noise: AudioBuffer | null = null;

  start() {
    if (!this.context) {
      this.context = new AudioContext();
      this.noise = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
    }
    void this.context.resume();
  }

  tone(frequency: number, duration: number, volume = 0.035, endFrequency = frequency) {
    const context = this.context;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, context.currentTime + duration);
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }

  rustle(duration: number, volume: number, frequency: number) {
    const context = this.context;
    if (!context || !this.noise) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.noise;
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(0, Math.random() * .5);
    source.stop(context.currentTime + duration);
  }

  step(time: number, speed: number, sliding: boolean) {
    if (time - this.lastStep < (sliding ? .2 : Math.max(.25, .48 - speed * .015))) return;
    this.lastStep = time;
    this.rustle(sliding ? .22 : .09, sliding ? .012 : .025, sliding ? 500 : 900);
  }

  wind(time: number, speed: number) {
    if (speed < 9 || time - this.lastWind < .45) return;
    this.lastWind = time;
    this.rustle(.5, .006, 420);
  }

  checkpoint() { this.tone(660, .2, .035, 990); }
  finish() { this.tone(440, .5, .04, 880); }
  jump() { this.tone(180, .12, .018, 260); }
  land() { this.rustle(.16, .04, 350); }
}
