import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { HAZE_COLOR, SUN_DIRECTION } from '../world/Sky.ts';

export type Quality = 'high' | 'medium' | 'low';

interface QualityPreset {
  pixelRatioCap: number;
  /** Upper bound on rendered pixels (keeps the MSAA HDR target affordable on 4K / hi-dpi screens). */
  pixelBudget: number;
  shadowMap: number;
  bloom: boolean;
  msaaSamples: number;
}

/** Vertical FOV used for the first-person arms and legs (kept narrow so close-up limbs are not stretched). */
export const VIEW_FOV = 58;

const PRESETS: Record<Quality, QualityPreset> = {
  high: { pixelRatioCap: 1.75, pixelBudget: 4.2e6, shadowMap: 2048, bloom: true, msaaSamples: 4 },
  medium: { pixelRatioCap: 1.25, pixelBudget: 2.5e6, shadowMap: 1024, bloom: true, msaaSamples: 4 },
  low: { pixelRatioCap: 1, pixelBudget: 1.6e6, shadowMap: 1024, bloom: false, msaaSamples: 0 },
};

/**
 * Owns the WebGL renderer, the main scene + the first-person "view" scene, lighting and the post chain.
 *
 * High / medium: scene -> 4x MSAA half-float target -> (view pass with cleared depth) -> bloom -> tone map.
 * Low: straight to the canvas (native MSAA) with no post-processing.
 */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** First-person arms / legs live in their own scene so they can never clip into the world. */
  readonly viewScene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Dedicated camera for the first-person body: fixed narrow FOV, follows the main camera's pose. */
  readonly viewCamera: THREE.PerspectiveCamera;
  readonly sun: SunLight;
  readonly viewSun: THREE.DirectionalLight;

  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private quality: Quality = 'high';
  private width = 1;
  private height = 1;
  private readonly canvas: HTMLCanvasElement;
  readonly hemi: THREE.HemisphereLight;
  private readonly viewHemi: THREE.HemisphereLight;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = true;
    // Accumulate draw-call statistics over every pass of a frame (reset manually in render()).
    this.renderer.info.autoReset = false;

    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.08, 3600);
    this.camera.matrixAutoUpdate = true;
    this.viewCamera = new THREE.PerspectiveCamera(VIEW_FOV, 16 / 9, 0.02, 30);

    this.scene.fog = new THREE.FogExp2(HAZE_COLOR.getHex(), 0.00088);

    // --- sun with two shadow cascades ---
    this.sun = new SunLight(0xfff0d8, 3.2);
    this.sun.position.copy(SUN_DIRECTION);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.far = 230;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 2.2;
    this.scene.add(this.sun);

    this.hemi = new THREE.HemisphereLight(0xa9d0ff, 0xe8e2d8, 0.3);
    this.scene.add(this.hemi);

    // --- first-person view scene lighting (matches the world) ---
    this.viewSun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    this.viewSun.position.copy(SUN_DIRECTION).multiplyScalar(10);
    this.viewScene.add(this.viewSun);
    this.viewScene.add(this.viewSun.target);
    this.viewHemi = new THREE.HemisphereLight(0xa9d0ff, 0xe8e2d8, 1.1);
    this.viewScene.add(this.viewHemi);
  }

  get currentQuality(): Quality {
    return this.quality;
  }

  /** Set the environment (reflection / ambient) map after the sky has been baked. */
  setEnvironment(env: THREE.Texture): void {
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.45;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const p = PRESETS[q];
    this.sun.shadow.mapSize.set(p.shadowMap, p.shadowMap);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.rebuild();
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.rebuild();
  }

  private pixelRatio(): number {
    const preset = PRESETS[this.quality];
    const byBudget = Math.sqrt(preset.pixelBudget / (this.width * this.height));
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap, byBudget));
  }

  /** Half-float render targets are needed for the HDR / bloom path. */
  private get hdrSupported(): boolean {
    const ext = this.renderer.extensions;
    return ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
  }

  private rebuild(): void {
    const preset = PRESETS[this.quality];
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.disposeComposer();
    if (preset.bloom && this.hdrSupported) {
      const w = Math.floor(this.width * pr);
      const h = Math.floor(this.height * pr);
      const target = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        samples: preset.msaaSamples,
        depthBuffer: true,
      });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.setPixelRatio(1);
      this.composer.setSize(w, h);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      const view = new RenderPass(this.viewScene, this.viewCamera);
      view.clear = false;
      view.clearDepth = true;
      this.composer.addPass(view);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.12, 0.6, 1.25);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
  }

  private disposeComposer(): void {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloom = null;
    }
  }

  setBloomStrength(strength: number): void {
    if (this.bloom) this.bloom.strength = strength;
  }

  /** Live-tuning hook for the debug API. */
  tune(o: { sun?: number; hemi?: number; env?: number; exposure?: number; bloom?: number; bloomThreshold?: number; bloomRadius?: number; fog?: number }): void {
    if (o.sun !== undefined) this.sun.intensity = o.sun;
    if (o.hemi !== undefined) this.hemi.intensity = o.hemi;
    if (o.env !== undefined) this.scene.environmentIntensity = o.env;
    if (o.exposure !== undefined) this.renderer.toneMappingExposure = o.exposure;
    if (this.bloom) {
      if (o.bloom !== undefined) this.bloom.strength = o.bloom;
      if (o.bloomThreshold !== undefined) this.bloom.threshold = o.bloomThreshold;
      if (o.bloomRadius !== undefined) this.bloom.radius = o.bloomRadius;
    }
    if (o.fog !== undefined && this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = o.fog;
  }

  render(): void {
    this.renderer.info.reset();
    // The body camera always shares the main camera's pose but keeps its own projection.
    this.viewCamera.position.copy(this.camera.position);
    this.viewCamera.quaternion.copy(this.camera.quaternion);
    this.viewCamera.aspect = this.camera.aspect;
    this.viewCamera.updateMatrixWorld(true);
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.autoClear = true;
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.viewScene, this.viewCamera);
      this.renderer.autoClear = true;
    }
  }

  dispose(): void {
    this.disposeComposer();
    this.renderer.dispose();
  }
}
