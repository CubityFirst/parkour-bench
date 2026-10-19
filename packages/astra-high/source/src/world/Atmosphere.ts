import * as THREE from 'three';

export function createAtmosphere(scene: THREE.Scene) {
  scene.background = new THREE.Color('#b7dfeb');
  scene.fog = new THREE.FogExp2('#bbdce5', 0.0028);
  scene.add(new THREE.HemisphereLight('#d9f1ff', '#526a74', 2.15));
  const sun = new THREE.DirectionalLight('#fff4dc', 3.5);
  sun.position.set(-70, 110, 55); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -65; sun.shadow.camera.right = 65;
  sun.shadow.camera.top = 75; sun.shadow.camera.bottom = -75;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
  sun.shadow.normalBias = 0.035; sun.shadow.bias = -0.0002;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color('#229ee0') }, bottom: { value: new THREE.Color('#d4eaf1') } },
    vertexShader: `varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 vPosition;uniform vec3 top;uniform vec3 bottom;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){vec3 d=normalize(vPosition);float h=max(0.,d.y);vec3 color=mix(bottom,top,pow(h,.25));
        vec2 uv=d.xz/(max(d.y,.04))*1.6;float n=noise(uv)*.5+noise(uv*2.1)*.3+noise(uv*4.2)*.2;
        float cloud=smoothstep(.57,.8,n)*smoothstep(.03,.17,h)*(1.-smoothstep(.6,.94,h));
        color=mix(color,vec3(.98,.99,1.),cloud*.6);gl_FragColor=vec4(color,1.);
        #include <colorspace_fragment>
      }`,
  }));
  sky.frustumCulled = false; scene.add(sky);
  return { sun, sky };
}
