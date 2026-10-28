import * as THREE from 'three';

export const SUN_DIRECTION = new THREE.Vector3(0.44, 0.76, 0.48).normalize();

const VERT = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vDirection = worldPosition.xyz - cameraPosition;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uTopColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uGroundColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  varying vec3 vDirection;

  void main() {
    vec3 dir = normalize(vDirection);
    float h = clamp(dir.y, -1.0, 1.0);

    // vertical gradient: bright haze at the horizon into deep blue overhead
    float t = pow(clamp(h, 0.0, 1.0), 0.45);
    vec3 col = mix(uHorizonColor, uTopColor, t);

    // haze band hugging the horizon
    col = mix(col, uHorizonColor, smoothstep(0.16, -0.02, h));
    // below the horizon fades into a soft ground haze
    col = mix(col, uGroundColor, smoothstep(-0.02, -0.35, h));

    float sun = max(dot(dir, uSunDirection), 0.0);
    col += uSunColor * pow(sun, 5200.0) * 14.0;  // sun disc
    col += uSunColor * pow(sun, 26.0) * 0.13;    // tight glow
    col += uSunColor * pow(sun, 3.0) * 0.035;    // very soft bloom

    gl_FragColor = vec4(col, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface SkyResult {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  horizonColor: THREE.Color;
}

/** Gradient sky dome with a sun disc. */
export function createSky(): SkyResult {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTopColor: { value: new THREE.Color(0x0f5fd0) },
      uHorizonColor: { value: new THREE.Color(0xd3e9fb) },
      uGroundColor: { value: new THREE.Color(0x9fb7c8) },
      uSunColor: { value: new THREE.Color(0xfff3d6) },
      uSunDirection: { value: SUN_DIRECTION.clone() },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: true,
  });

  const geometry = new THREE.SphereGeometry(1, 32, 20);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(4000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  return { mesh, material, horizonColor: new THREE.Color(0xd3e9fb) };
}

/**
 * Bake the sky into a PMREM environment map so glass and metal surfaces pick up
 * a believable sky reflection without any downloaded assets.
 */
export function createEnvironment(renderer: THREE.WebGLRenderer, sky: SkyResult): THREE.Texture {
  const envScene = new THREE.Scene();
  const envMaterial = sky.material.clone();
  envMaterial.uniforms = sky.material.uniforms;
  envMaterial.depthTest = true;
  envMaterial.depthWrite = true;

  const envMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), envMaterial);
  envMesh.scale.setScalar(10);
  envScene.add(envMesh);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromScene(envScene, 0, 0.1, 100);
  pmrem.dispose();

  envMesh.geometry.dispose();
  (envMaterial as THREE.ShaderMaterial).dispose();

  return target.texture;
}
