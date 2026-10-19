import * as THREE from 'three';

export function createSky(scene: THREE.Scene) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    uniforms: {},
    vertexShader: `varying vec3 direction; void main() { direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `
      varying vec3 direction;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){
        vec3 d=normalize(direction);
        float elevation=max(d.y,0.);
        vec3 color=mix(vec3(.64,.82,.92),vec3(.012,.245,.64),pow(elevation,.48));
        vec2 p=d.xz/(elevation+.18)*2.7;
        float cloud=noise(p)*.55+noise(p*2.1)*.26+noise(p*4.4)*.13+noise(p*8.2)*.06;
        float mask=smoothstep(.53,.72,cloud)*smoothstep(.035,.2,elevation)*.78;
        color=mix(color,vec3(.97,.985,1.),mask);
        float sun=pow(max(dot(d,normalize(vec3(.5,.8,-.25))),0.),30.);
        color+=vec3(.19,.16,.1)*sun;
        gl_FragColor=vec4(color,1.);
        #include <colorspace_fragment>
      }`
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1100, 32, 18), material);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  sky.onBeforeRender = (_renderer, _scene, camera) => { sky.position.copy(camera.position); };
  scene.add(sky);
}
