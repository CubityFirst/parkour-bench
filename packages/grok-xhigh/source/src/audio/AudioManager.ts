export class AudioManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private windGain: GainNode | null = null
  private slideGain: GainNode | null = null
  muted = false

  resume() {
    const ctx = this.ensure()
    if (ctx.state === 'suspended') void ctx.resume()
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (this.master) this.master.gain.value = muted ? 0 : 0.7
  }

  setWind(amount: number) {
    if (!this.windGain) return
    const target = this.muted ? 0 : Math.max(0, Math.min(1, amount)) * 0.08
    this.windGain.gain.setTargetAtTime(target, this.ctx!.currentTime, 0.1)
  }

  setSlide(on: boolean) {
    if (!this.slideGain) return
    const target = !on || this.muted ? 0 : 0.045
    this.slideGain.gain.setTargetAtTime(target, this.ctx!.currentTime, 0.05)
  }

  jump() {
    this.tone(180, 420, 0.09, 'sine', 0.12)
  }

  land(hard: boolean) {
    this.noiseBurst(hard ? 0.2 : 0.1, 180, 0.12)
  }

  step() {
    this.noiseBurst(0.06, 700, 0.045)
  }

  vault() {
    this.tone(240, 180, 0.08, 'triangle', 0.06)
  }

  wall() {
    this.tone(320, 480, 0.1, 'sine', 0.05)
  }

  checkpoint() {
    this.tone(523, 523, 0.12, 'sine', 0.07)
    window.setTimeout(() => this.tone(784, 784, 0.16, 'sine', 0.06), 90)
  }

  finish() {
    const notes = [523, 659, 784, 1046]
    notes.forEach((n, i) => {
      window.setTimeout(() => this.tone(n, n, 0.18, 'triangle', 0.07), i * 110)
    })
  }

  private ensure() {
    if (this.ctx) return this.ctx
    const ctx = new AudioContext()
    this.ctx = ctx
    const master = ctx.createGain()
    master.gain.value = this.muted ? 0 : 0.7
    master.connect(ctx.destination)
    this.master = master

    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffer(ctx)
    noise.loop = true
    const windFilter = ctx.createBiquadFilter()
    windFilter.type = 'lowpass'
    windFilter.frequency.value = 400
    const wind = ctx.createGain()
    wind.gain.value = 0
    noise.connect(windFilter)
    windFilter.connect(wind)
    wind.connect(master)
    noise.start()
    this.windGain = wind

    const slideSrc = ctx.createBufferSource()
    slideSrc.buffer = this.noiseBuffer(ctx)
    slideSrc.loop = true
    const slideFilter = ctx.createBiquadFilter()
    slideFilter.type = 'bandpass'
    slideFilter.frequency.value = 900
    slideFilter.Q.value = 0.7
    const slide = ctx.createGain()
    slide.gain.value = 0
    slideSrc.connect(slideFilter)
    slideFilter.connect(slide)
    slide.connect(master)
    slideSrc.start()
    this.slideGain = slide
    return ctx
  }

  private noiseBuffer(ctx: AudioContext) {
    if (this.noiseBuf) return this.noiseBuf
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    this.noiseBuf = buf
    return buf
  }

  private tone(from: number, to: number, dur: number, type: OscillatorType, gain: number) {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master || this.muted) return
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(from, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), ctx.currentTime + dur)
    g.gain.setValueAtTime(gain, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    osc.connect(g)
    g.connect(master)
    osc.start()
    osc.stop(ctx.currentTime + dur + 0.02)
  }

  private noiseBurst(gain: number, freq: number, dur: number) {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master || this.muted) return
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer(ctx)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    src.connect(filter)
    filter.connect(g)
    g.connect(master)
    src.start()
    src.stop(ctx.currentTime + dur + 0.02)
  }
}
