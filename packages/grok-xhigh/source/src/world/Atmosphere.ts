import * as THREE from 'three'

export interface Atmosphere {
  sun: THREE.DirectionalLight
  sunTarget: THREE.Object3D
  sky: THREE.Mesh
  sunDisc: THREE.Sprite
  update(x: number, y: number, z: number, time: number): void
}

export function createAtmosphere(scene: THREE.Scene): Atmosphere {
  const skyGeo = new THREE.SphereGeometry(700, 28, 18)
  const colors: number[] = []
  const pos = skyGeo.attributes.position
  const sunDir = new THREE.Vector3(0.35, 0.55, 0.18).normalize()
  const v = new THREE.Vector3()
  const zenith = new THREE.Color('#3c9eef')
  const horizon = new THREE.Color('#d9f3ff')
  const ground = new THREE.Color('#8ea6b6')
  const sunCol = new THREE.Color('#fff6df')
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    const h = THREE.MathUtils.smoothstep(v.y, -0.15, 0.55)
    const col = ground.clone().lerp(horizon, THREE.MathUtils.smoothstep(v.y, -0.2, 0.08))
    col.lerp(zenith, h)
    const sun = Math.pow(Math.max(0, v.dot(sunDir)), 28)
    col.lerp(sunCol, Math.min(1, sun * 1.4))
    colors.push(col.r, col.g, col.b)
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const sky = new THREE.Mesh(
    skyGeo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }),
  )
  sky.frustumCulled = false
  sky.renderOrder = -1
  scene.add(sky)

  const discCanvas = document.createElement('canvas')
  discCanvas.width = 64
  discCanvas.height = 64
  const ctx = discCanvas.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30)
  g.addColorStop(0, 'rgba(255,252,240,1)')
  g.addColorStop(0.35, 'rgba(255,236,190,0.85)')
  g.addColorStop(1, 'rgba(255,220,150,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const discTex = new THREE.CanvasTexture(discCanvas)
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: discTex,
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  }))
  sunDisc.scale.set(70, 70, 1)
  scene.add(sunDisc)

  const hemi = new THREE.HemisphereLight(0xcfe9ff, 0xf4f7fb, 0.72)
  scene.add(hemi)
  const fill = new THREE.DirectionalLight(0xd7e6f5, 0.35)
  fill.position.set(-30, 20, -10)
  scene.add(fill)

  const sun = new THREE.DirectionalLight(0xfff4e4, 3.1)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 2
  sun.shadow.camera.far = 90
  sun.shadow.camera.left = -28
  sun.shadow.camera.right = 28
  sun.shadow.camera.top = 28
  sun.shadow.camera.bottom = -28
  sun.shadow.bias = -0.00025
  sun.shadow.normalBias = 0.035
  const sunTarget = new THREE.Object3D()
  scene.add(sunTarget)
  sun.target = sunTarget
  scene.add(sun)

  const sunWorld = sunDir.clone()
  return {
    sun,
    sunTarget,
    sky,
    sunDisc,
    update(x, y, z, time) {
      sky.position.set(x, y, z)
      const sx = Math.round(x / 2) * 2
      const sz = Math.round(z / 2) * 2
      sunTarget.position.set(sx, y, sz)
      sun.position.set(sx + 22, y + 36, sz + 12)
      sunDisc.position.set(x + sunWorld.x * 420, y + sunWorld.y * 420, z + sunWorld.z * 420)
      sunDisc.material.rotation = time * 0.01
    },
  }
}
