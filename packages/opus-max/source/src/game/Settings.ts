/** Player-adjustable options, persisted in localStorage. */

export type CameraMotion = 'full' | 'reduced' | 'off';
export type Quality = 'high' | 'low';

export interface Settings {
  /** Mouse sensitivity multiplier. */
  sensitivity: number;
  invertY: boolean;
  /** Horizontal field of view in degrees. */
  fov: number;
  cameraMotion: CameraMotion;
  /** Master volume 0..1. */
  volume: number;
  /** Sprint whenever moving forward, without holding Shift. */
  autoSprint: boolean;
  hints: boolean;
  quality: Quality;
}

const STORAGE_KEY = 'roofline-settings';

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  invertY: false,
  fov: 96,
  cameraMotion: 'full',
  volume: 0.7,
  autoSprint: false,
  hints: true,
  quality: 'high',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const s = { ...DEFAULT_SETTINGS, ...parsed };
    s.sensitivity = clampNum(s.sensitivity, 0.1, 4, DEFAULT_SETTINGS.sensitivity);
    s.fov = clampNum(s.fov, 70, 120, DEFAULT_SETTINGS.fov);
    s.volume = clampNum(s.volume, 0, 1, DEFAULT_SETTINGS.volume);
    if (!['full', 'reduced', 'off'].includes(s.cameraMotion)) s.cameraMotion = 'full';
    if (!['high', 'low'].includes(s.quality)) s.quality = 'high';
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** True when the player has never saved settings (first visit: defaults may be auto-tuned). */
export function hasSavedSettings(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private mode, sandboxed iframes); settings just won't persist.
  }
}

/** Scale applied to all procedural camera motion. */
export function motionScale(s: Settings): number {
  return s.cameraMotion === 'full' ? 1 : s.cameraMotion === 'reduced' ? 0.35 : 0;
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
}
