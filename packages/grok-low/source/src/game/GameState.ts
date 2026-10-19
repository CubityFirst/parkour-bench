export type GameMode = "menu" | "playing" | "paused" | "finished";

export interface Settings {
  sensitivity: number;
  reduceMotion: boolean;
}

const SETTINGS_KEY = "rooftop-flow-settings";
const BEST_KEY = "rooftop-flow-best";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { sensitivity: 1, reduceMotion: false };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const sensitivity = typeof parsed.sensitivity === "number" ? clampSens(parsed.sensitivity) : 1;
    return { sensitivity, reduceMotion: Boolean(parsed.reduceMotion) };
  } catch {
    return { sensitivity: 1, reduceMotion: false };
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    sensitivity: clampSens(settings.sensitivity),
    reduceMotion: settings.reduceMotion,
  }));
}

export function loadBest(): number | null {
  const raw = localStorage.getItem(BEST_KEY);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Stores the faster time and returns the best. */
export function saveBest(time: number): number {
  const prev = loadBest();
  const best = prev === null ? time : Math.min(prev, time);
  localStorage.setItem(BEST_KEY, String(best));
  return best;
}

export function formatTime(time: number): string {
  const centis = Math.max(0, Math.floor(time * 100));
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  const frac = centis % 100;
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${frac.toString().padStart(2, "0")}`;
}

function clampSens(value: number): number {
  return Math.max(0.35, Math.min(2, value));
}
