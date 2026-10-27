export type CameraMotion = 'full' | 'reduced';

export interface Settings {
  sensitivity: number;
  cameraMotion: CameraMotion;
  /** Horizontal field of view in degrees. */
  fov: number;
  volume: number;
  invertY: boolean;
}

const KEY = 'rooftop-flow.settings.v2';

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  cameraMotion: 'full',
  fov: 95,
  volume: 0.7,
  invertY: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      sensitivity: clampNum(parsed.sensitivity, 0.1, 4, DEFAULT_SETTINGS.sensitivity),
      cameraMotion: parsed.cameraMotion === 'reduced' ? 'reduced' : 'full',
      fov: clampNum(parsed.fov, 75, 115, DEFAULT_SETTINGS.fov),
      volume: clampNum(parsed.volume, 0, 1, DEFAULT_SETTINGS.volume),
      invertY: parsed.invertY === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — settings just won't persist */
  }
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}
