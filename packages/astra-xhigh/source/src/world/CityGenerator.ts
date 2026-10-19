import * as THREE from "three";
import { Architecture, type Materials } from "./Materials";

export function createCity(scene: THREE.Scene, b: Architecture, m: Materials) {
  let seed = 809;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // A street grid keeps the skyline architectural, with a clear corridor around the course.
  for (let row = 0; row < 23; row++)
    for (let col = -5; col <= 5; col++) {
      if (col === 0) continue;
      const x = col * 46 + (random() - 0.5) * 14,
        z = 80 - row * 49 + (random() - 0.5) * 10;
      const w = 21 + random() * 17,
        d = 23 + random() * 15;
      const baseHeight =
        col === -1 || col === 1 ? 25 + random() * 35 : 40 + random() * 115;
      const h =
        row < 6 && Math.abs(col) < 4
          ? Math.min(baseHeight, 65 + random() * 18)
          : baseHeight;
      const glass = random() > 0.35;
      b.box(
        x,
        h / 2 - 10,
        z,
        w,
        h,
        d,
        glass ? (random() > 0.5 ? m.glass : m.blue) : m.white,
      );
      b.box(x, h - 9.8, z, w + 0.8, 0.45, d + 0.8, m.white);
      if (glass) {
        for (let xx = -w / 2; xx <= w / 2 + 0.1; xx += w / 4)
          b.box(x + xx, h / 2 - 10, z + d / 2 + 0.05, 0.17, h, 0.14, m.white);
        for (let yy = 5; yy < h; yy += 9)
          b.box(x, yy - 10, z, w + 0.15, 0.3, d + 0.15, m.white);
      } else {
        b.box(x, h / 2 - 10, z + d / 2 + 0.03, w - 1, h - 2, 0.12, m.glass);
        b.box(x - w / 2 - 0.03, h / 2 - 10, z, 0.12, h - 2, d - 1, m.blue);
        for (let yy = 4; yy < h; yy += 4)
          b.box(x, yy - 10, z, w + 0.12, 0.48, d + 0.12, m.white);
      }
      b.box(x - w * 0.18, h - 8.8, z, w * 0.22, 1.8, d * 0.24, m.metal);
      b.box(x + w * 0.16, h - 8.4, z - 3, w * 0.12, 2.6, d * 0.16, m.white);
      if (h > 100) {
        b.box(x, h - 5, z, w * 0.65, 9, d * 0.65, m.glass);
        b.box(x, h + 4, z, 0.3, 17, 0.3, m.metal);
      }
    }
  // Ground and intersecting streets are visible far below the rooftop edges.
  b.box(0, -10.5, -300, 1100, 1, 1600, m.dark);
  for (let x = -230; x <= 230; x += 46)
    b.box(x, -9.9, -300, 9, 0.1, 1100, m.metal);
  // A soft procedural sky with high, wispy clouds; no downloaded assets.
  const skyGeo = new THREE.SphereGeometry(1500, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: `varying vec3 vWorld; void main(){vWorld=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 vWorld;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    void main(){vec3 d=normalize(vWorld);float h=max(d.y,0.);vec3 c=mix(vec3(.71,.86,.92),vec3(.04,.45,.75),pow(h,.34));vec2 p=d.xz/(h+.2)*3.;float n=noise(p)*.55+noise(p*2.1)*.27+noise(p*4.2)*.12;float cloud=smoothstep(.52,.76,n)*smoothstep(.03,.3,h)*.67;c=mix(c,vec3(.98,.99,.96),cloud);gl_FragColor=vec4(c,1.);}`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}
