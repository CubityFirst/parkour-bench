import * as THREE from 'three'
import { AudioManager } from '../audio/AudioManager'
import { FirstPersonCamera } from '../player/FirstPersonCamera'
import { PlayerController } from '../player/PlayerController'
import { PlayerView } from '../player/PlayerView'
import { HUD } from '../ui/HUD'
import { Menu } from '../ui/Menu'
import { createAtmosphere } from '../world/Atmosphere'
import { CheckpointSystem } from '../world/Checkpoints'
import { buildCity } from '../world/CityGenerator'
import { CollisionWorld } from '../world/CollisionWorld'
import { buildCourse } from '../world/Course'
import { LevelView } from '../world/Level'
import { createMaterials, tuneTextures } from '../world/Materials'
import { PHYS } from './constants'
import { Input } from './Input'
import { loadBest, loadSettings, saveBest, saveSettings, type Phase, type Settings } from './GameState'
import type { MoveInput } from './types'

export class Game {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly fps: FirstPersonCamera
  private readonly input: Input
  private readonly audio = new AudioManager()
  private readonly hud: HUD
  private readonly menu: Menu
  private readonly course = buildCourse()
  private readonly world: CollisionWorld
  private readonly player: PlayerController
  private readonly checkpoints: CheckpointSystem
  private readonly level: LevelView
  private readonly atmosphere: ReturnType<typeof createAtmosphere>
  private readonly view: PlayerView
  private readonly seenHints = new Set<string>()

  private phase: Phase = 'menu'
  private settings: Settings
  private best: number | null
  private timeMs = 0
  private acc = 0
  private last = performance.now()
  private menuTime = 0
  private debug = false
  private debugLines: THREE.LineSegments[] | null = null

  constructor(private readonly canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.settings = loadSettings()
    this.best = loadBest()
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene.fog = new THREE.FogExp2(0xc5e6fb, 0.0042)
    this.scene.background = new THREE.Color(0xc5e6fb)

    const mats = createMaterials()
    tuneTextures(this.renderer, mats)
    this.scene.environment = mats.env

    this.level = new LevelView(this.course, mats)
    this.scene.add(this.level.group)
    this.scene.add(buildCity(this.course, mats))
    this.atmosphere = createAtmosphere(this.scene)

    this.world = new CollisionWorld(this.course.solids)
    this.player = new PlayerController(this.world)
    this.checkpoints = new CheckpointSystem(this.course)
    this.player.reset(this.course.spawn.x, this.course.spawn.y, this.course.spawn.z)

    this.camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 900)
    this.scene.add(this.camera)
    this.fps = new FirstPersonCamera(this.camera)
    this.fps.yaw = this.course.spawn.yaw
    this.fps.sensitivity = this.settings.sensitivity
    this.fps.motion = this.settings.motion ? 1 : 0.12
    this.view = new PlayerView()
    this.view.mount(this.camera)

    this.input = new Input(window)
    this.hud = new HUD(ui)
    this.menu = new Menu(ui, this.settings, this.best)
    this.audio.setMuted(!this.settings.sound)
    this.bindUi()
    this.bindPointer()
    window.addEventListener('resize', () => this.resize())
    window.addEventListener('keydown', (event) => {
      if (event.code === 'F3') this.toggleDebug()
    })
    this.frame = this.frame.bind(this)
  }

  start() {
    this.placeMenuCamera()
    requestAnimationFrame(this.frame)
  }

  private bindUi() {
    this.menu.onStart = () => {
      this.audio.resume()
      this.beginRun()
      this.lockPointer()
    }
    this.menu.onResume = () => {
      this.audio.resume()
      this.lockPointer()
    }
    this.menu.onRestart = () => {
      this.audio.resume()
      this.beginRun()
      this.lockPointer()
    }
    this.menu.onCheckpoint = () => {
      this.respawn(false)
      this.lockPointer()
    }
    this.menu.onMenu = () => {
      this.phase = 'menu'
      this.hud.setVisible(false)
      this.menu.showMain()
      if (document.pointerLockElement) document.exitPointerLock()
    }
    this.menu.onSettings = (settings) => {
      this.settings = settings
      saveSettings(settings)
      this.fps.sensitivity = settings.sensitivity
      this.fps.motion = settings.motion ? 1 : 0.12
      this.audio.setMuted(!settings.sound)
    }
  }

  private lockPointer() {
    const pending = this.canvas.requestPointerLock()
    if (pending && typeof (pending as Promise<void>).catch === 'function') {
      void (pending as Promise<void>).catch(() => {})
    }
  }

  private bindPointer() {
    this.canvas.addEventListener('click', () => {
      if (this.phase === 'playing' && document.pointerLockElement !== this.canvas) this.lockPointer()
    })
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas
      if (!locked && this.phase === 'playing') {
        this.phase = 'paused'
        this.menu.showPause()
        this.hud.setVisible(false)
      } else if (locked && this.phase === 'paused') {
        this.phase = 'playing'
        this.menu.hide()
        this.hud.setVisible(true)
      }
    })
    document.addEventListener('mousemove', (event) => {
      if (this.phase !== 'playing' || document.pointerLockElement !== this.canvas) return
      this.fps.look(event.movementX, event.movementY)
    })
  }

  private beginRun() {
    this.checkpoints.reset()
    this.seenHints.clear()
    this.timeMs = 0
    this.acc = 0
    const spawn = this.course.spawn
    this.player.reset(spawn.x, spawn.y, spawn.z)
    this.fps.yaw = spawn.yaw
    this.fps.pitch = 0
    this.phase = 'playing'
    this.menu.hide()
    this.hud.setVisible(true)
    this.hud.setTime(0)
    this.hud.showHint('WASD move  ·  Shift sprint  ·  Space jump')
  }

  private respawn(resetTime: boolean) {
    const cp = this.checkpoints.current
    this.player.reset(cp.x, cp.y, cp.z)
    this.fps.yaw = cp.yaw
    this.fps.pitch = 0
    if (resetTime) this.timeMs = 0
    this.hud.flashRespawn()
    this.audio.land(true)
  }

  private frame(now: number) {
    const frameDt = Math.min(PHYS.maxFrameDt, (now - this.last) / 1000)
    this.last = now
    if (this.phase === 'playing') {
      this.timeMs += frameDt * 1000
      this.acc += frameDt
      const edges = this.input.consumeEdges()
      if (edges.respawn) this.respawn(false)
      const held = this.input.held()
      const basis = this.fps.sampleBasis()
      let first = true
      let steps = 0
      while (this.acc >= PHYS.fixedDt && steps < 8) {
        const stepInput: MoveInput = {
          ...held,
          jumpPressed: first && edges.jumpPressed,
          vaultPressed: first && edges.vaultPressed,
        }
        first = false
        this.player.update(PHYS.fixedDt, stepInput, basis)
        this.afterPhysics()
        this.acc -= PHYS.fixedDt
        steps += 1
      }
      if (steps === 8) this.acc = 0
      const alpha = this.acc / PHYS.fixedDt
      this.fps.apply(this.player, alpha, frameDt)
      this.view.update(this.player, this.fps.pitch, this.fps.motion)
      this.audio.setWind(Math.max(0, (this.player.speed - 6) / 6))
      this.audio.setSlide(this.player.mode === 'slide' && this.player.grounded)
      this.playEvents()
    } else {
      this.menuTime += frameDt
      if (this.phase === 'menu') this.placeMenuCamera()
      this.audio.setWind(0.15)
      this.audio.setSlide(false)
    }

    this.hud.tick(frameDt)
    this.hud.setTime(this.timeMs)
    const focus = this.phase === 'playing' ? this.player : { x: this.camera.position.x, y: this.course.spawn.y, z: this.camera.position.z }
    this.atmosphere.update(focus.x, focus.y, focus.z, this.menuTime + this.timeMs / 1000)
    this.level.update(this.menuTime + this.timeMs / 1000, this.checkpoints.index)
    if (this.debug && this.phase === 'playing') {
      this.hud.setDebug(
        `${this.player.mode}  ${this.player.speed.toFixed(1)} m/s\n` +
        `x ${this.player.x.toFixed(1)}  y ${this.player.y.toFixed(2)}  z ${this.player.z.toFixed(1)}\n` +
        `ground ${this.player.grounded}  cp ${this.checkpoints.index}`,
      )
    } else {
      this.hud.setDebug('')
    }
    this.renderer.render(this.scene, this.camera)
    requestAnimationFrame(this.frame)
  }

  private afterPhysics() {
    const player = this.player
    if (player.y < PHYS.fallY) {
      this.respawn(false)
      this.hud.showToast('Respawn')
      return
    }
    const cp = this.checkpoints.touch(player.x, player.y, player.z)
    if (cp) {
      this.hud.showToast(`Checkpoint  ${cp.name}`)
      this.audio.checkpoint()
    }
    for (const hint of this.course.hints) {
      if (this.seenHints.has(hint.id)) continue
      if (player.x < hint.minX || player.x > hint.maxX || player.z < hint.minZ || player.z > hint.maxZ) continue
      if (player.y < hint.minY || player.y > hint.maxY) continue
      this.seenHints.add(hint.id)
      this.hud.showHint(hint.text)
    }
    const finish = this.course.finish
    if (
      this.phase === 'playing' &&
      player.x > finish.minX && player.x < finish.maxX &&
      player.z > finish.minZ && player.z < finish.maxZ &&
      player.y > finish.minY && player.y < finish.maxY
    ) {
      this.complete()
    }
  }

  private playEvents() {
    const events = this.player.events
    if (events.jump) this.audio.jump()
    if (events.land) this.audio.land(true)
    if (events.step) this.audio.step()
    if (events.vault) this.audio.vault()
    if (events.wall || events.wallJump) this.audio.wall()
  }

  private complete() {
    this.phase = 'complete'
    const time = this.timeMs
    const previous = this.best
    const isNew = previous === null || time < previous
    if (isNew) {
      this.best = time
      saveBest(time)
      this.menu.setBest(time)
    }
    this.audio.finish()
    this.hud.setVisible(false)
    this.menu.showFinish(time, this.best, isNew)
    if (document.pointerLockElement) document.exitPointerLock()
  }

  private placeMenuCamera() {
    const spawn = this.course.spawn
    const bob = Math.sin(this.menuTime * 0.35) * 0.2
    this.camera.position.set(spawn.x - 11, spawn.y + 5.2 + bob, spawn.z - 7)
    this.camera.lookAt(spawn.x + 3, spawn.y + 1.1, spawn.z + 22)
  }

  private resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  private toggleDebug() {
    this.debug = !this.debug
    if (!this.debugLines) {
      const mat = new THREE.LineBasicMaterial({ color: 0xff4455 })
      this.debugLines = this.course.solids.map((solid) => {
        const geo = new THREE.BoxGeometry(
          solid.maxX - solid.minX,
          solid.maxY - solid.minY,
          solid.maxZ - solid.minZ,
        )
        const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat)
        lines.position.set(
          (solid.minX + solid.maxX) / 2,
          (solid.minY + solid.maxY) / 2,
          (solid.minZ + solid.maxZ) / 2,
        )
        this.scene.add(lines)
        return lines
      })
    }
    for (const line of this.debugLines) line.visible = this.debug
  }
}
