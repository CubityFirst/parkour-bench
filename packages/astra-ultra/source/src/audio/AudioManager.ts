/** Small, entirely procedural soundscape. Audio starts only after a user gesture. */
export class AudioManager {
  enabled = true;

  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windSource: AudioBufferSourceNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.55;
  private lastUpdate = -1;
  private sources = new Set<AudioScheduledSourceNode>();
  private lastEvents = new Map<string, number>();

  init(): void {
    try {
      if (!this.context) {
        const browser = window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        };
        const Context = browser.AudioContext ?? browser.webkitAudioContext;
        if (!Context) return;
        const context = new Context();
        this.context = context;
        this.master = context.createGain();
        this.master.gain.value = this.enabled ? this.volume : 0;
        this.master.connect(context.destination);

        const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.noiseBuffer = buffer;

        this.windSource = context.createBufferSource();
        this.windSource.buffer = buffer;
        this.windSource.loop = true;
        this.windFilter = context.createBiquadFilter();
        this.windFilter.type = 'lowpass';
        this.windFilter.frequency.value = 550;
        this.windFilter.Q.value = 0.4;
        this.windGain = context.createGain();
        this.windGain.gain.value = 0;
        this.windSource.connect(this.windFilter);
        this.windFilter.connect(this.windGain);
        this.windGain.connect(this.master);
        this.windSource.start();
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch {
      // Missing/blocked audio must never prevent the game from starting.
      this.dispose();
    }
  }

  setVolume(value: number): void {
    this.volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.55;
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.context.currentTime, 0.05);
    }
  }

  update(speed: number, active: boolean): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    const now = context.currentTime;
    // Audio parameters need updating only about 20 times a second.
    if (now - this.lastUpdate < 0.05) return;
    this.lastUpdate = now;
    const motion = active && Number.isFinite(speed) ? Math.min(Math.max(speed / 15, 0), 1.3) : 0;
    this.master?.gain.setTargetAtTime(this.enabled ? this.volume : 0, now, 0.06);
    this.windGain?.gain.setTargetAtTime(motion * motion * 0.14, now, active ? 0.2 : 0.08);
    this.windFilter?.frequency.setTargetAtTime(350 + motion * 1150, now, 0.25);
  }

  play(event: string): void {
    const context = this.context;
    if (!this.enabled || !context || context.state !== 'running' || !this.master) return;
    const now = context.currentTime;
    const cooldown = event === 'step' ? 0.15 : 0.07;
    if (now - (this.lastEvents.get(event) ?? -10) < cooldown) return;
    this.lastEvents.set(event, now);

    switch (event) {
      case 'step':
        this.noise(0.07, 0.16, 760, 'lowpass');
        this.tone(90 + Math.random() * 12, 0.07, 0.12, 0, 'sine', 43);
        break;
      case 'jump':
        this.noise(0.16, 0.12, 1500, 'bandpass');
        break;
      case 'land':
        this.noise(0.15, 0.26, 580, 'lowpass');
        this.tone(82, 0.16, 0.2, 0, 'sine', 34);
        break;
      case 'slide':
        this.noise(0.7, 0.16, 2100, 'bandpass');
        break;
      case 'vault':
        this.noise(0.18, 0.16, 900, 'lowpass');
        this.tone(115, 0.09, 0.09, 0, 'sine', 65);
        break;
      case 'wallrun':
        this.noise(0.4, 0.12, 1350, 'bandpass');
        break;
      case 'checkpoint':
        [523.25, 659.25, 783.99].forEach((note, i) => this.tone(note, 0.3, 0.07, i * 0.09));
        break;
      case 'finish':
        [523.25, 659.25, 783.99, 1046.5].forEach((note, i) => this.tone(note, 0.7, 0.08, i * 0.13));
        this.tone(261.63, 1.1, 0.06, 0.4);
        break;
      case 'respawn':
        this.tone(261.63, 0.25, 0.04);
        this.tone(392, 0.35, 0.04, 0.12);
        break;
    }
  }

  dispose(): void {
    for (const source of this.sources) {
      try { source.stop(); } catch { /* A source may already have finished. */ }
      source.disconnect();
    }
    this.sources.clear();
    if (this.windSource) {
      try { this.windSource.stop(); } catch { /* Safe after a partial initialization. */ }
      this.windSource.disconnect();
    }
    this.windFilter?.disconnect();
    this.windGain?.disconnect();
    this.master?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
    this.windSource = null;
    this.windFilter = null;
    this.windGain = null;
    this.noiseBuffer = null;
    this.lastUpdate = -1;
    this.lastEvents.clear();
  }

  private noise(duration: number, volume: number, frequency: number, type: BiquadFilterType): void {
    const context = this.context;
    if (!context || !this.master || !this.noiseBuffer) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 0.6;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      this.sources.delete(source);
    };
    source.start(now, Math.random() * (2 - duration));
    source.stop(now + duration + 0.03);
  }

  private tone(frequency: number, duration: number, volume: number, delay = 0, type: OscillatorType = 'sine', endFrequency?: number): void {
    const context = this.context;
    if (!context || !this.master) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    this.sources.add(oscillator);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      this.sources.delete(oscillator);
    };
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }
}
