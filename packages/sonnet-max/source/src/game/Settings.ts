import type { Quality } from '../render/RenderPipeline.ts';

export interface SettingsData {
  /** Mouse sensitivity multiplier (1 = default). */
  sensitivity: number;
  /** Horizontal field of view in degrees. */
  fov: number;
  /** 0..1 camera motion amount (head bob, roll, FOV kick, impacts). */
  motion: number;
  /** Master volume 0..1. */
  volume: number;
  quality: Quality;
}

const STORAGE_KEY = 'rooftop-flow-settings';

const DEFAULTS: SettingsData = {
  sensitivity: 1,
  fov: 90,
  motion: 1,
  volume: 0.7,
  quality: 'high',
};

export class Settings {
  data: SettingsData = { ...DEFAULTS };
  private listeners: Array<(s: SettingsData) => void> = [];

  constructor() {
    // Respect the OS "reduce motion" preference until the player chooses otherwise.
    try {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) this.data.motion = 0.35;
    } catch {
      /* matchMedia unavailable */
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SettingsData>;
        this.data = { ...this.data, ...sanitize(parsed) };
      }
    } catch {
      /* corrupt or unavailable storage: keep defaults */
    }
  }

  onChange(fn: (s: SettingsData) => void): void {
    this.listeners.push(fn);
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    this.data[key] = value;
    this.save();
    for (const l of this.listeners) l(this.data);
  }

  private save(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable (private mode) - settings simply do not persist */
    }
  }
}

function sanitize(p: Partial<SettingsData>): Partial<SettingsData> {
  const out: Partial<SettingsData> = {};
  const num = (v: unknown, lo: number, hi: number): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
  const s = num(p.sensitivity, 0.2, 3);
  if (s !== undefined) out.sensitivity = s;
  const f = num(p.fov, 70, 110);
  if (f !== undefined) out.fov = f;
  const m = num(p.motion, 0, 1);
  if (m !== undefined) out.motion = m;
  const v = num(p.volume, 0, 1);
  if (v !== undefined) out.volume = v;
  if (p.quality === 'high' || p.quality === 'medium' || p.quality === 'low') out.quality = p.quality;
  return out;
}
