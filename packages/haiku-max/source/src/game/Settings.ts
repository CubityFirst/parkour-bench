export interface Settings {
  /** Multiplier on mouse look speed. */
  sensitivity: number;
  /** Reduces head bob, roll, landing spring and FOV kicks. */
  reducedMotion: boolean;
  soundOn: boolean;
}

const STORAGE_KEY = 'rooftop-flow:settings';

const DEFAULTS: Settings = {
  sensitivity: 1,
  reducedMotion: false,
  soundOn: true,
};

/** Loads saved settings, falling back to defaults for anything missing or invalid. */
export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      sensitivity:
        typeof parsed.sensitivity === 'number' ? Math.min(3, Math.max(0.2, parsed.sensitivity)) : DEFAULTS.sensitivity,
      reducedMotion: typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : DEFAULTS.reducedMotion,
      soundOn: typeof parsed.soundOn === 'boolean' ? parsed.soundOn : DEFAULTS.soundOn,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode, quota). Settings then last for this session only.
  }
}
