import * as THREE from 'three'
import type { MatId } from '../game/types'

export interface Materials {
  byId: Record<MatId, THREE.MeshStandardMaterial>
  flag: THREE.MeshStandardMaterial
  trim: THREE.MeshStandardMaterial
  banner: THREE.MeshStandardMaterial
  beam: THREE.MeshStandardMaterial
  env: THREE.CubeTexture
}

export function createMaterials(): Materials {
  const roof = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#f4f6f8'
    ctx.fillRect(0, 0, 256, 256)
    ctx.strokeStyle = 'rgba(150, 164, 178, 0.45)'
    ctx.lineWidth = 2
    for (let i = 0; i <= 256; i += 64) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, 256)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(256, i)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(120, 132, 146, 0.35)'
    for (let y = 8; y < 256; y += 64) {
      for (let x = 8; x < 256; x += 64) ctx.fillRect(x, y, 3, 3)
    }
  })
  const concrete = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#d5dde6'
    ctx.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 400; i++) {
      const v = 180 + Math.random() * 50
      ctx.fillStyle = `rgba(${v},${v},${v},0.18)`
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2)
    }
  })
  const windows = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#173044'
    ctx.fillRect(0, 0, 128, 128)
    for (let y = 4; y < 128; y += 16) {
      for (let x = 4; x < 128; x += 12) {
        const lit = (x * 3 + y * 7) % 17 === 0
        ctx.fillStyle = lit ? '#ffb068' : '#d5e8f4'
        ctx.fillRect(x, y, 8, 11)
      }
    }
  })

  const std = (
    color: number,
    extra: Partial<THREE.MeshStandardMaterialParameters> = {},
  ) => new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.02, ...extra })

  const byId: Record<MatId, THREE.MeshStandardMaterial> = {
    white: std(0xf7f9fb, { map: roof, roughness: 0.88, envMapIntensity: 0.18 }),
    concrete: std(0xd7e0ea, { map: concrete, roughness: 0.9, envMapIntensity: 0.15 }),
    skirt: std(0xb4c0cc, { map: concrete, roughness: 0.95, envMapIntensity: 0.08 }),
    red: std(0xff2c34, { roughness: 0.4, metalness: 0.08, emissive: 0x5a0010, emissiveIntensity: 0.45, envMapIntensity: 0.2 }),
    metal: std(0x8b959f, { roughness: 0.38, metalness: 0.72, envMapIntensity: 0.45 }),
    glass: std(0xc5d8e6, { map: windows, roughness: 0.12, metalness: 0.86, envMapIntensity: 1 }),
    dark: std(0x1a2128, { roughness: 0.72, metalness: 0.2 }),
    orange: std(0xff8c1f, { roughness: 0.45, emissive: 0xc45500, emissiveIntensity: 0.55, envMapIntensity: 0.2 }),
  }

  const env = makeEnv()
  for (const mat of Object.values(byId)) mat.envMap = env

  return {
    byId,
    env,
    flag: std(0xff8c1f, {
      roughness: 0.5,
      emissive: 0xd25a00,
      emissiveIntensity: 0.7,
      side: THREE.DoubleSide,
      envMap: env,
    }),
    trim: std(0xff2a32, {
      roughness: 0.38,
      emissive: 0x6a0012,
      emissiveIntensity: 0.55,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      envMap: env,
    }),
    banner: new THREE.MeshStandardMaterial({
      map: labelTexture('FINISH', '#ff2a32', '#ffffff'),
      roughness: 0.5,
      metalness: 0.05,
      emissive: 0x3a0008,
      emissiveIntensity: 0.25,
      envMap: env,
    }),
    beam: std(0xff2a32, { emissive: 0xff1a28, emissiveIntensity: 0.9, roughness: 0.35 }),
  }
}

export function tuneTextures(renderer: THREE.WebGLRenderer, mats: Materials) {
  const max = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const visit = (mat: THREE.Material) => {
    const m = mat as THREE.MeshStandardMaterial
    if (m.map) m.map.anisotropy = max
  }
  Object.values(mats.byId).forEach(visit)
  visit(mats.flag)
  visit(mats.banner)
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')
  draw(ctx)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

export function labelTexture(text: string, bg: string, fg: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 512, 128)
  ctx.fillStyle = fg
  ctx.font = '700 78px Impact, Arial Black, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 256, 68)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeEnv() {
  const face = (top: string, bottom: string) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 0, 64)
    g.addColorStop(0, top)
    g.addColorStop(1, bottom)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
    return canvas
  }
  const tex = new THREE.CubeTexture([
    face('#8ec8ee', '#d7f1ff'),
    face('#8ec8ee', '#d7f1ff'),
    face('#49a6f0', '#49a6f0'),
    face('#9eb0be', '#9eb0be'),
    face('#8ec8ee', '#d7f1ff'),
    face('#8ec8ee', '#d7f1ff'),
  ])
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}
