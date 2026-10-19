import {
  BoxGeometry, CanvasTexture, Color, CylinderGeometry, InstancedMesh,
  Mesh, MeshStandardMaterial, Object3D, PlaneGeometry,
  Scene, SRGBColorSpace, Vector3,
} from 'three';

/** The city is scenery. Keeping it separate from the course also keeps physics cheap. */
export class CityGenerator {
  private scene: Scene;
  private seed = 1947;

  constructor(scene: Scene) {
    this.scene = scene;
    this.build();
  }

  private random() {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private facade(kind: 'glass' | 'white' | 'dark') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const c = canvas.getContext('2d')!;
    const rows = kind === 'white' ? 13 : 16;
    const cols = kind === 'white' ? 10 : 14;
    c.fillStyle = kind === 'white' ? '#cbdde1' : kind === 'dark' ? '#1b465e' : '#6ea5bb';
    c.fillRect(0, 0, 512, 512);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const shade = this.random();
        c.fillStyle = kind === 'white'
          ? `rgba(37,81,103,${0.38 + shade * 0.21})`
          : `rgba(${shade > 0.6 ? '176,221,232' : '16,65,93'},${0.1 + shade * 0.24})`;
        const w = 512 / cols;
        const h = 512 / rows;
        c.fillRect(x * w + 2, y * h + 2, w - 4, h - (kind === 'white' ? 11 : 4));
      }
    }
    const reflection = c.createLinearGradient(0, 0, 512, 512);
    reflection.addColorStop(0, 'rgba(225,250,255,.28)');
    reflection.addColorStop(0.38, 'rgba(225,250,255,.03)');
    reflection.addColorStop(0.44, 'rgba(225,250,255,.19)');
    reflection.addColorStop(1, 'rgba(5,47,77,.1)');
    c.fillStyle = reflection;
    c.fillRect(0, 0, 512, 512);
    c.strokeStyle = kind === 'white' ? '#edf4f4' : '#a6c7d1';
    c.lineWidth = kind === 'white' ? 6 : 1.4;
    for (let row = 0; row <= rows; row++) {
      c.beginPath(); c.moveTo(0, row * 512 / rows); c.lineTo(512, row * 512 / rows); c.stroke();
    }
    c.lineWidth = 1.2;
    for (let col = 0; col <= cols; col++) {
      c.beginPath(); c.moveTo(col * 512 / cols, 0); c.lineTo(col * 512 / cols, 512); c.stroke();
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }

  private build() {
    const white = new MeshStandardMaterial({ color: '#f2f4ed', roughness: 0.84 });
    const blue = new MeshStandardMaterial({ map: this.facade('glass'), color: '#c4e6ef', roughness: 0.35, metalness: 0.15 });
    const pale = new MeshStandardMaterial({ map: this.facade('white'), roughness: 0.72, color: '#f1f6f7' });
    const dark = new MeshStandardMaterial({ map: this.facade('dark'), color: '#d0e7ee', roughness: 0.44, metalness: 0.12 });
    const concrete = new MeshStandardMaterial({ color: '#a6bec8', roughness: 1 });
    const red = new MeshStandardMaterial({ color: '#ed302f', roughness: 0.65 });
    const geometry = new BoxGeometry(1, 1, 1);
    const groups: {position: Vector3; size: Vector3; tint: Color}[][] = [[], [], []];
    const caps: {position: Vector3; size: Vector3; tint: Color}[] = [];
    const equipment: {position: Vector3; size: Vector3; tint: Color}[] = [];

    // A central avenue leaves a long, readable sightline through the whole course.
    for (let side = -1; side <= 1; side += 2) {
      for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 23; column++) {
          const z = 49 - column * 41 - this.random() * 17;
          const x = side * (35 + row * 53 + this.random() * 19);
          const width = 19 + this.random() * 26;
          const depth = 23 + this.random() * 25;
          let top = row === 0 ? -15 + this.random() * 25 : 10 + this.random() * (45 + row * 21);
          if (row === 0 && column < 3) top = -9 + this.random() * 15;
          const height = top + 94;
          const style = (column + row * 2 + (side > 0 ? 1 : 0)) % 3;
          const tint = new Color().setHSL(0.54, 0.08 + this.random() * 0.05, 0.88 + this.random() * 0.1);
          groups[style].push({ position: new Vector3(x, -94 + height / 2, z), size: new Vector3(width, height, depth), tint });
          caps.push({ position: new Vector3(x, top + 0.35, z), size: new Vector3(width + 0.6, 0.7, depth + 0.6), tint: new Color('#f4f5ec') });
          if (row < 2) {
            const ew = 2 + this.random() * 4;
            equipment.push({ position: new Vector3(x + 2, top + 1, z - 2), size: new Vector3(ew, 1.5, 3), tint: new Color('#a7b8bd') });
            equipment.push({ position: new Vector3(x - width * 0.3, top + 1.8, z + depth * 0.26), size: new Vector3(1.7, 3.2, 2.2), tint: new Color('#e5ece9') });
          }
        }
      }
    }

    // Deliberately spaced landmark towers form the far skyline, rather than a wall.
    for (let i = 0; i < 22; i++) {
      const x = (i - 10.5) * 28;
      const top = 27 + this.random() * 110;
      const width = 14 + this.random() * 15;
      const z = -815 - this.random() * 90;
      groups[i % 3].push({ position: new Vector3(x, (-94 + top) / 2, z), size: new Vector3(width, top + 94, 24), tint: new Color('#d3e9ef') });
      if (i % 3 === 0) {
        groups[0].push({ position: new Vector3(x, top + 8, z), size: new Vector3(width * 0.58, 16, 17), tint: new Color('#d3e9ef') });
        caps.push({ position: new Vector3(x, top + 25, z), size: new Vector3(0.3, 25, 0.3), tint: new Color('#cadde0') });
      }
    }

    const batch = (items: typeof caps, material: MeshStandardMaterial | MeshStandardMaterial[]) => {
      const mesh = new InstancedMesh(geometry, material, items.length);
      const transform = new Object3D();
      items.forEach((item, i) => {
        transform.position.copy(item.position);
        transform.scale.copy(item.size);
        transform.updateMatrix();
        mesh.setMatrixAt(i, transform.matrix);
        mesh.setColorAt(i, item.tint);
      });
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
    };
    [blue, pale, dark].forEach((facade, index) => batch(groups[index], facade));
    batch(caps, white);
    batch(equipment, concrete);

    const ground = new Mesh(new PlaneGeometry(1800, 2100), new MeshStandardMaterial({ color: '#8babb6', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -94, -350);
    this.scene.add(ground);

    // A few bright city graphics make the surroundings feel inhabited.
    this.billboard(49, 9, -67, 15, 7, 'MOVE', 'THE CITY IS YOURS', '#ed352e');
    this.billboard(-45, 15, -116, 18, 8, 'AERIS', 'A BETTER PERSPECTIVE', '#237b9a');
    this.billboard(40, 10, -280, 14, 6, 'NORTH', 'URBAN MOBILITY / 26', '#e94c30');
    this.billboard(-43, 10, -490, 17, 7, 'KEEP GOING', 'FIND YOUR OWN LINE', '#df372f');

    // Slender communications towers break up the rectangular skyline.
    for (const [x, z, y] of [[-69, -142, 68], [84, -380, 77], [-84, -588, 65]]) {
      const towerTop = y - 11;
      const towerHeight = towerTop + 94;
      const tower = new Mesh(geometry, blue);
      tower.position.set(x, -94 + towerHeight / 2, z);
      tower.scale.set(12, towerHeight, 15);
      tower.receiveShadow = true;
      this.scene.add(tower);
      const roof = new Mesh(geometry, white);
      roof.position.set(x, towerTop - 0.16, z);
      roof.scale.set(12.6, 0.32, 15.6);
      this.scene.add(roof);
      const mast = new Mesh(new CylinderGeometry(0.3, 0.8, 22, 6), red);
      mast.position.set(x, y, z);
      this.scene.add(mast);
      for (let n = 0; n < 3; n++) {
        const crossbar = new Mesh(geometry, white);
        crossbar.position.set(x, y + n * 5, z);
        crossbar.scale.set(4, 0.4, 0.5);
        this.scene.add(crossbar);
      }
    }
  }

  private billboard(x: number, y: number, z: number, width: number, height: number, title: string, subtitle: string, color: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const c = canvas.getContext('2d')!;
    c.fillStyle = color; c.fillRect(0, 0, 1024, 512);
    c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 3; c.strokeRect(30, 30, 964, 452);
    c.fillStyle = '#fff'; c.font = 'bold 131px Arial'; c.fillText(title, 70, 273);
    c.font = '25px Arial'; c.fillText(subtitle, 74, 337);
    c.fillRect(74, 123, 92, 7);
    c.font = '20px Arial'; c.fillText('CITY NETWORK', 74, 432);
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    const board = new Mesh(new PlaneGeometry(width, height), new MeshStandardMaterial({ map: texture, roughness: 0.8 }));
    board.position.set(x, y, z);
    this.scene.add(board);
  }
}
