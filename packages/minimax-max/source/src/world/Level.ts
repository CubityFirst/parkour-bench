import { Vector3 } from 'three';
import { CollisionWorld } from './CollisionWorld';
import type { MaterialKey } from './Materials';

export interface LevelBlock {
  /** Centre of the block. */
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  mat: MaterialKey;
  /** Solid blocks are registered in the collision world. */
  solid: boolean;
  tag: string;
  /** Rotation around the Y axis in radians. */
  rotY: number;
}

export interface LevelPole {
  x: number;
  y: number;
  z: number;
  /** Radius of the cylinder. */
  r: number;
  /** Length along the local Y axis. */
  h: number;
  mat: MaterialKey;
  rotX: number;
  rotZ: number;
}

export interface Checkpoint {
  id: number;
  label: string;
  position: Vector3;
  yaw: number;
  radius: number;
}

export interface Hint {
  id: string;
  text: string;
  position: Vector3;
  radius: number;
}

export interface SectionTrigger {
  index: number;
  name: string;
  position: Vector3;
  radius: number;
}

export interface LevelOptions {
  /** Which edges get a thin curb (n = low z, s = high z, w = low x, e = high x). */
  trim?: { n?: boolean; s?: boolean; w?: boolean; e?: boolean };
  /** Material of the building body below the roof. */
  body?: MaterialKey;
  /** Height of the building body below the roof. */
  bodyHeight?: number;
  /** Skip the building body entirely. */
  noBody?: boolean;
  /** Roof slab material. */
  roof?: MaterialKey;
  /** Where the intended route runs across the roof (keeps props out of it). */
  routeZ?: number;
}

/**
 * The playable level: six hand designed sections of rooftops strung
 * together into one continuous run.
 */
export class Level {
  readonly world = new CollisionWorld();
  readonly blocks: LevelBlock[] = [];
  readonly poles: LevelPole[] = [];
  readonly checkpoints: Checkpoint[] = [];
  readonly hints: Hint[] = [];
  readonly sections: SectionTrigger[] = [];
  readonly spawn = { position: new Vector3(0, 0.02, 0), yaw: -Math.PI / 2 };
  readonly finish = {
    min: new Vector3(),
    max: new Vector3(),
    position: new Vector3(),
  };
  /** Every rooftop, used to scatter roof furniture. */
  private readonly platforms: {
    x0: number;
    x1: number;
    z0: number;
    z1: number;
    top: number;
    routeZ: number;
  }[] = [];

  constructor() {
    this.buildSection1();
    this.buildSection2();
    this.buildSection3();
    this.buildSection4();
    this.buildSection5();
    this.buildSection6();
    this.dress();
  }

  /** Scatters roof furniture that never blocks the intended route. */
  private dress(): void {
    let seed = 20240413;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (const platform of this.platforms) {
      const width = platform.x1 - platform.x0;
      const depth = platform.z1 - platform.z0;
      if (width < 6 || depth < 6) continue;

      const center = (platform.z0 + platform.z1) / 2;
      const routeOffset = platform.routeZ - center;
      const items = Math.max(1, Math.floor(width / 6));

      for (let i = 0; i < items; i++) {
        const x = platform.x0 + 2.5 + random() * Math.max(1, width - 5);
        // Furniture lives on the side of the roof that the route does not use.
        let z: number;
        if (Math.abs(routeOffset) > 3) {
          z = routeOffset > 0 ? platform.z0 + 1.6 + random() * 1.4 : platform.z1 - 1.6 - random() * 1.4;
        } else {
          z = random() > 0.5 ? platform.z0 + 1.6 + random() * 1.4 : platform.z1 - 1.6 - random() * 1.4;
        }

        const roll = random();
        if (roll < 0.34) {
          this.vent(x, z, platform.top, 1.3 + random() * 0.9, 0.7 + random() * 0.5, 1.3 + random() * 0.9);
        } else if (roll < 0.66) {
          this.grating(x, z, platform.top, 1.8 + random() * 2.2, 1.4 + random() * 1.6);
        } else if (roll < 0.82) {
          this.block(x, platform.top + 0.35, z, 1.1 + random() * 0.8, 0.7, 1.1 + random() * 0.8, 'white', {
            solid: true,
            tag: 'vent',
          });
          this.block(x, platform.top + 0.72, z, 0.9, 0.06, 0.9, 'dark');
        } else if (roll < 0.93) {
          this.antenna(x, z, platform.top, 2.5 + random() * 4);
        } else {
          this.poles.push({
            x,
            y: platform.top + 0.45,
            z,
            r: 0.16,
            h: 2 + random() * 4,
            mat: 'red',
            rotX: 0,
            rotZ: Math.PI / 2,
          });
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // building helpers
  // -----------------------------------------------------------------------

  private block(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: MaterialKey,
    options: { solid?: boolean; tag?: string; rotY?: number } = {},
  ): void {
    const solid = options.solid ?? false;
    this.blocks.push({
      x,
      y,
      z,
      w,
      h,
      d,
      mat,
      solid,
      tag: options.tag ?? 'decor',
      rotY: options.rotY ?? 0,
    });
    if (solid) {
      this.world.add(
        x - w / 2,
        y - h / 2,
        z - d / 2,
        x + w / 2,
        y + h / 2,
        z + d / 2,
        options.tag ?? 'solid',
      );
    }
  }

  /** A rooftop: solid roof slab plus the building body underneath. */
  private platform(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    top: number,
    options: LevelOptions = {},
  ): void {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const w = x1 - x0;
    const d = z1 - z0;

    // Solid roof slab the player stands on.
    this.block(cx, top - 0.5, cz, w, 1, d, options.roof ?? 'concrete', { solid: true, tag: 'roof' });

    this.platforms.push({
      x0,
      x1,
      z0,
      z1,
      top,
      routeZ: options.routeZ ?? (z0 + z1) / 2,
    });

    if (!options.noBody) {
      const bodyHeight = options.bodyHeight ?? 48;
      const bodyY = top - 1 - bodyHeight / 2;
      this.block(cx, bodyY, cz, w - 0.7, bodyHeight, d - 0.7, options.body ?? 'white', { tag: 'body' });
    }

    const trim = options.trim ?? {};
    const curb = 0.14;
    const width = 0.5;
    if (trim.n) this.block(cx, top + curb / 2, z0 + width / 2, w, curb, width, 'dark', { solid: true, tag: 'curb' });
    if (trim.s) this.block(cx, top + curb / 2, z1 - width / 2, w, curb, width, 'dark', { solid: true, tag: 'curb' });
    if (trim.w) this.block(x0 + width / 2, top + curb / 2, cz, width, curb, d, 'dark', { solid: true, tag: 'curb' });
    if (trim.e) this.block(x1 - width / 2, top + curb / 2, cz, width, curb, d, 'dark', { solid: true, tag: 'curb' });
  }

  /** Red chevrons painted on the roof that point towards the next jump. */
  private chevrons(x: number, z: number, top: number, count = 3, spacing = 1.5): void {
    for (let i = 0; i < count; i++) {
      const offset = i * spacing;
      for (const dir of [-1, 1]) {
        this.block(
          x + offset,
          top + 0.02,
          z + dir * 0.55,
          1.15,
          0.04,
          0.34,
          'red',
          { rotY: dir * 0.62 },
        );
      }
    }
  }

  /** A red landing marker painted on the far side of a jump. */
  private landingMark(x: number, z: number, top: number, width = 4): void {
    this.block(x, top + 0.02, z, 1.6, 0.04, width, 'red');
    this.block(x - 0.9, top + 0.02, z, 0.3, 0.04, width, 'red');
    this.block(x + 0.9, top + 0.02, z, 0.3, 0.04, width, 'red');
  }

  /** A low beam the player has to slide under. */
  private lowBeam(x: number, z: number, top: number, span: number, clearance = 1.15): void {
    const height = 0.9;
    this.block(x, top + clearance + height / 2, z, 0.55, height, span, 'gray', {
      solid: true,
      tag: 'beam',
    });
    // Red warning stripes on the beam.
    this.block(x, top + clearance + height + 0.02, z, 0.62, 0.05, span, 'red');
    for (const side of [-1, 1]) {
      this.block(
        x,
        top + (clearance + height) / 2,
        z + side * (span / 2 - 0.3),
        0.55,
        clearance + height,
        0.5,
        'white',
        { solid: true, tag: 'post' },
      );
    }
  }

  /** A red crate that can be vaulted. */
  private crate(x: number, z: number, top: number, w = 2, h = 1, d = 2.4): void {
    this.block(x, top + h / 2, z, w, h, d, 'red', { solid: true, tag: 'crate' });
    this.block(x, top + h + 0.03, z, w * 0.7, 0.06, d * 0.7, 'dark');
  }

  /** A neighbouring building that frames the route and blocks the view. */
  private neighbour(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    top: number,
    mat: MaterialKey = 'white',
  ): void {
    const width = x1 - x0;
    const depth = z1 - z0;
    const height = top + 52;
    this.block((x0 + x1) / 2, top - height / 2, (z0 + z1) / 2, width, height, depth, mat, {
      solid: true,
      tag: 'neighbour',
    });
    // Cornice and window bands.
    this.block((x0 + x1) / 2, top + 0.2, (z0 + z1) / 2, width + 0.5, 0.4, depth + 0.5, 'gray');
    for (let y = top - 4; y > top - Math.min(height - 6, 22); y -= 5) {
      this.block((x0 + x1) / 2, y, (z0 + z1) / 2, width + 0.12, 1.5, depth + 0.12, 'glassDark');
    }
  }

  /** Rooftop air handling unit. */
  private vent(x: number, z: number, top: number, w = 1.8, h = 0.9, d = 1.8): void {
    this.block(x, top + h / 2, z, w, h, d, 'white', { solid: true, tag: 'vent' });
    this.block(x, top + h + 0.04, z, w * 0.8, 0.08, d * 0.8, 'dark');
  }

  /** A dark grating panel painted onto the roof. */
  private grating(x: number, z: number, top: number, w = 3, d = 2): void {
    this.block(x, top + 0.015, z, w, 0.03, d, 'dark');
  }

  /** Antenna mast with a red tip. */
  private antenna(x: number, z: number, top: number, height = 4): void {
    this.poles.push({ x, y: top + height / 2, z, r: 0.07, h: height, mat: 'metal', rotX: 0, rotZ: 0 });
    this.poles.push({ x, y: top + height + 0.12, z, r: 0.16, h: 0.24, mat: 'red', rotX: 0, rotZ: 0 });
  }

  /** A horizontal pipe running along the roof. */
  private pipe(x: number, z: number, top: number, length: number, r = 0.13, rotZ = 0): void {
    this.poles.push({ x, y: top + r + 0.2, z, r, h: length, mat: 'red', rotX: 0, rotZ: rotZ + Math.PI / 2 });
  }

  /** Small rooftop hut with a red door - pure decoration. */
  private hut(x: number, z: number, top: number, w = 4, h = 2.6, d = 3): void {
    this.block(x, top + h / 2, z, w, h, d, 'white', { solid: true, tag: 'hut' });
    this.block(x, top + h + 0.08, z, w + 0.3, 0.16, d + 0.3, 'gray');
    this.block(x + w / 2 + 0.03, top + 1.05, z, 0.06, 2.1, 1.1, 'red');
  }

  private checkpoint(id: number, label: string, x: number, y: number, z: number, yaw = -Math.PI / 2): void {
    this.checkpoints.push({
      id,
      label,
      position: new Vector3(x, y + 0.05, z),
      yaw,
      radius: 3.6,
    });
  }

  private hint(id: string, text: string, x: number, y: number, z: number, radius = 6): void {
    this.hints.push({ id, text, position: new Vector3(x, y, z), radius });
  }

  private section(index: number, name: string, x: number, y: number, z: number, radius = 9): void {
    this.sections.push({ index, name, position: new Vector3(x, y, z), radius });
  }

  // -----------------------------------------------------------------------
  // Section 1 - warm up
  // -----------------------------------------------------------------------

  private buildSection1(): void {
    const top = 0;
    this.section(1, 'WARM UP', 2, top, 0, 10);

    // Start pad.
    this.platform(-6, 20, -12, 12, top, { trim: { n: true, s: true } });
    this.platform(22, 30, -12, 12, top, { trim: { n: true, s: true, e: true } });

    // Red start pad + doorway.
    this.block(0, top + 0.02, 0, 3, 0.04, 3, 'red');
    this.hut(-4, -9.5, top, 4, 2.8, 3.2);

    // Tutorial obstacle: a red crate that is vaulted.
    this.crate(8, 0, top);

    // Tutorial obstacle: a low beam that is slid under.
    this.lowBeam(13.5, 0, top, 9);

    // Small gap that is jumped.
    this.chevrons(17.4, 0, top, 2, 1.3);
    this.landingMark(22.6, 0, top, 5);
    // Gap into the first rooftop leap.
    this.chevrons(27.6, 0, top, 2, 1.3);
    this.landingMark(34.6, 0, top, 5);

    // Rooftop dressing.
    this.vent(4.5, 6.5, top, 2.4, 1.1, 2);
    this.vent(11.5, -7.5, top, 1.8, 0.8, 1.8);
    this.grating(6, 4, top, 4, 2.6);
    this.grating(16.5, -4.5, top, 3, 2);
    this.antenna(-2.5, 8.5, top, 5.5);
    this.antenna(26, -8.5, top, 4);
    this.pipe(3.5, -11.2, top, 14);
    this.pipe(24, 11.2, top, 12);

    this.checkpoint(1, 'WARM UP', 26.5, top, 0);

    // Neighbouring buildings that give the rooftop a city context.
    this.neighbour(-8, 15, -31, -16, 5.5);
    this.neighbour(18, 34, 14, 30, 8);

    this.hint('move', 'WASD TO MOVE   ·   SHIFT TO SPRINT', 2, top, 0, 7);
    this.hint('jump', 'SPACE TO JUMP   ·   HOLD FOR HEIGHT', 5.5, top, 0, 4);
    this.hint('vault', 'E TO VAULT THE RED CRATE', 6.5, top, 0, 3.2);
    this.hint('slide', 'CTRL TO SLIDE UNDER THE BEAM', 11.5, top, 0, 3.4);
    this.hint('gap', 'SPRINT AND JUMP THE GAP', 17, top, 0, 3.4);
  }

  // -----------------------------------------------------------------------
  // Section 2 - rooftop leaps
  // -----------------------------------------------------------------------

  private buildSection2(): void {
    this.section(2, 'ROOFTOP LEAPS', 36, 0, 0, 10);

    this.platform(34, 46, -12, 12, 0, { trim: { n: true, s: true } });
    this.platform(50.5, 62, -14, 10, 0, { trim: { n: true, s: true }, body: 'white' });
    this.platform(65.5, 80, -12, 12, 1, { trim: { n: true, s: true }, body: 'concrete' });

    // Route markers.
    this.chevrons(43.2, 0, 0, 3, 1.4);
    this.landingMark(51.6, 0, 0, 5);
    this.chevrons(59.6, 0, 0, 3, 1.3);
    this.landingMark(66.6, 0, 1, 5);

    // Dressing.
    this.vent(37.5, 7, 0, 2.2, 1, 2.2);
    this.vent(53, -9.5, 0, 2, 0.9, 2);
    this.vent(69.5, 6.5, 1, 2.4, 1.1, 2);
    this.grating(41, -5, 0, 3.4, 2.2);
    this.grating(56, 4, 0, 3.4, 2.2);
    this.grating(72, -4, 1, 3.4, 2.2);
    this.antenna(44, -9, 0, 6);
    this.antenna(58, 7.5, 0, 5);
    this.antenna(76, 8.5, 1, 5.5);
    this.pipe(35.5, -11.3, 0, 18);
    this.pipe(68, 11.3, 1, 20);
    this.hut(78, -9, 1, 3.4, 2.4, 3);

    this.checkpoint(2, 'ROOFTOP LEAPS', 72, 1, 0);

    this.neighbour(36, 52, -33, -18, 9.5);
    this.neighbour(64, 78, 15, 30, 6);

    this.hint('leaps1', 'RED PAINT MARKS THE ROUTE', 34, 0, 0, 6);
    this.hint('leaps2', 'KEEP YOUR MOMENTUM BETWEEN ROOFS', 52, 0, -2, 6);
    this.hint('leaps3', 'JUMP UP AND ACROSS', 64.5, 0, -1, 5);
  }

  // -----------------------------------------------------------------------
  // Section 3 - low pass
  // -----------------------------------------------------------------------

  private buildSection3(): void {
    const top = 1;
    this.section(3, 'LOW PASS', 84, top, 0, 10);

    this.platform(82, 99, -12, 12, top, { trim: { n: true, s: true } });
    this.platform(101.5, 108, -12, 12, top, { trim: { n: true, s: true, e: true } });

    // Three low beams that have to be slid under.
    this.lowBeam(86.5, 0, top, 9);
    this.lowBeam(91.5, 0, top, 9);
    this.lowBeam(96.5, 0, top, 9);

    this.chevrons(96.8, 0, top, 2, 1.2);
    this.landingMark(102.2, 0, top, 5);
    // Gap into the wall run section.
    this.chevrons(105.6, 0, top, 2, 1.2);
    this.landingMark(110.8, 0, top, 5);

    // Dressing: red ventilation ducts along the sides.
    this.vent(84.5, 8.5, top, 2.6, 1.1, 2.4);
    this.vent(89, -9, top, 2.6, 1.1, 2.4);
    this.vent(94, 9, top, 2.6, 1.1, 2.4);
    this.vent(98, -8.5, top, 2.2, 1, 2.2);
    this.grating(85, -6, top, 3, 2);
    this.grating(92.5, 5.5, top, 3, 2);
    this.pipe(83, -11.3, top, 24);
    this.pipe(102, 11.3, top, 12);
    this.antenna(105, -9.5, top, 5);

    this.checkpoint(3, 'LOW PASS', 84, top, 0);
    this.checkpoint(4, 'LOW PASS', 105, top, 0);

    this.neighbour(84, 99, -30, -16, 3.5);
    this.neighbour(84, 97, 15, 28, 6.5);

    this.hint('slide2', 'CTRL TO SLIDE UNDER THE BEAMS', 84.5, top, 0, 4.5);
    this.hint('slide3', 'SLIDE, THEN JUMP OUT OF IT', 99.5, top, 0, 4);
  }

  // -----------------------------------------------------------------------
  // Section 4 - wall run
  // -----------------------------------------------------------------------

  private buildSection4(): void {
    const top = 1;
    this.section(4, 'WALL RUN', 113, top, 0, 10);

    this.platform(110, 121, -14, 6, top, { trim: { n: true, s: true }, routeZ: 4.6 });
    this.platform(130.5, 148, -14, 6, top, { trim: { n: true, s: true }, routeZ: 4.6 });

    // The tall facade that is used for the wall run. Its bright red face is
    // the runnable surface.
    this.block(127.5, -17, 14.04, 17, 62, 15.92, 'white', { solid: true, tag: 'facade' });
    this.block(127.5, 3.8, 6.04, 15.5, 4.8, 0.08, 'red', { solid: true, tag: 'wallrun' });

    // Red guide strip that funnels the runner along the wall.
    this.block(113.5, top + 0.02, 4.7, 11, 0.04, 0.9, 'red');
    this.chevrons(118.4, 4.5, top, 2, 1.2);
    this.landingMark(131.2, 4.5, top, 5);
    // Gap into the combo section.
    this.chevrons(145.6, 0, top, 2, 1.2);
    this.landingMark(150.8, -6, top, 5);

    this.vent(112, -10, top, 2, 0.9, 2);
    this.grating(115, -3, top, 3, 2);
    this.antenna(134, -11, top, 6);
    this.pipe(112, -13.4, top, 34);

    this.checkpoint(5, 'WALL RUN', 113, top, 4.5);
    this.checkpoint(6, 'WALL RUN', 144, top, 4.5);

    this.hint('wall1', 'RUN ALONG THE RED WALL', 112, top, 2, 6);
    this.hint('wall2', 'JUMP AND WALL RUN TO THE FAR ROOF', 116.5, top, 4, 5);
  }

  // -----------------------------------------------------------------------
  // Section 5 - combination
  // -----------------------------------------------------------------------

  private buildSection5(): void {
    const top = 1;
    this.section(5, 'FLOW COMBO', 152, top, -4, 10);

    this.platform(150, 164, -14, 2, top, { trim: { n: true, s: true }, routeZ: -9.5 });
    this.platform(168.3, 180, -14, 2, top, { trim: { n: true, s: true }, routeZ: -9.5 });
    this.platform(186, 200, -14, 2, top, { trim: { n: true, s: true, e: true }, routeZ: -9.5 });

    // Facade on the opposite side, used for a second wall run.
    this.block(180, -17.5, -19.04, 36, 61, 9.92, 'white', { solid: true, tag: 'facade' });
    this.block(180, 3.8, -14.04, 34, 4.8, 0.08, 'red', { solid: true, tag: 'wallrun' });

    // Combo elements.
    this.crate(154, -6, top, 2.2, 1.05, 2.6);
    this.lowBeam(159.3, -6, top, 8);
    this.chevrons(161.8, -6, top, 2, 1.3);
    this.landingMark(169.4, -6, top, 5);
    this.block(173, top + 0.02, -12.4, 12, 0.04, 0.9, 'red');
    this.chevrons(177.5, -12.4, top, 2, 1.2);
    this.landingMark(187, -12.4, top, 5);

    this.vent(151.5, 3.5, top, 1.8, 0.8, 1.8);
    this.grating(160, 2.5, top, 3, 2);
    this.antenna(170, 4.5, top, 5);
    this.antenna(196, -12, top, 5.5);
    this.pipe(152, 5.4, top, 26);
    this.hut(198, 2, top, 3.4, 2.4, 3);

    this.checkpoint(7, 'FLOW COMBO', 153, top, -6);
    this.checkpoint(8, 'FLOW COMBO', 170, top, -6);
    this.checkpoint(9, 'FLOW COMBO', 196, top, -12);

    this.neighbour(150, 162, -38, -27, 7.5);
    this.neighbour(190, 202, 12, 26, 5);

    this.hint('combo1', 'E TO VAULT   ·   CTRL TO SLIDE', 152, top, -6, 5);
    this.hint('combo2', 'JUMP THE GAP WITH MOMENTUM', 162.5, top, -6, 4);
    this.hint('combo3', 'THE RED WALL IS ON YOUR LEFT', 170, top, -8, 7);
  }

  // -----------------------------------------------------------------------
  // Section 6 - final sprint
  // -----------------------------------------------------------------------

  private buildSection6(): void {
    this.section(6, 'FINAL SPRINT', 205, 1, -4, 12);

    this.platform(202, 213, -14, 6, 1, { trim: { n: true, s: true } });
    this.platform(217.5, 228, -12, 8, 0.5, { trim: { n: true, s: true } });
    this.platform(232, 244, -12, 8, 0.5, { trim: { n: true, s: true } });

    this.chevrons(211, -4, 1, 2, 1.2);
    this.landingMark(218.4, -4, 0.5, 5);
    this.chevrons(225.8, -4, 0.5, 2, 1.2);
    this.landingMark(232.8, -4, 0.5, 5);
    // Gap into the final sprint.
    this.chevrons(197.6, -4, 1, 2, 1.2);
    this.landingMark(202.8, -4, 1, 5);

    // Finish gate.
    this.block(240, 0.5 + 1.8, -2.7, 0.5, 3.6, 0.5, 'red', { solid: true, tag: 'gate' });
    this.block(240, 0.5 + 1.8, 2.7, 0.5, 3.6, 0.5, 'red', { solid: true, tag: 'gate' });
    this.block(240, 0.5 + 3.7, 0, 0.6, 0.7, 6.4, 'red');
    this.block(240, 0.5 + 4.15, 0, 0.4, 0.2, 5.4, 'dark');
    this.finish.min.set(238.5, 0.5, -3.7);
    this.finish.max.set(241.5, 4.6, 3.7);
    this.finish.position.set(240, 0.5, 0);

    this.vent(203.5, 3.5, 1, 1.8, 0.8, 1.8);
    this.vent(220, 5.5, 0.5, 2, 0.9, 2);
    this.grating(224, -9, 0.5, 3, 2);
    this.antenna(226, 6.5, 0.5, 5);
    this.antenna(242, -10, 0.5, 6);
    this.pipe(234, 7.4, 0.5, 18);

    this.checkpoint(10, 'FINAL SPRINT', 204, 1, -4);

    this.neighbour(214, 232, -28, -14, 4.5);
    this.neighbour(234, 248, 12, 26, 6);

    this.hint('final1', 'SPRINT TO THE FINISH', 206, 1, -4, 6);
    this.hint('final2', 'RED GATE = FINISH LINE', 234, 0.5, -4, 6);
  }
}
