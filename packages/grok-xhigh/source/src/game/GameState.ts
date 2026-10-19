export type Phase = 'menu' | 'playing' | 'paused' | 'complete'

export interface Settings {
  sensitivity: number
  motion: boolean
  sound: boolean
}

const SETTINGS_KEY = 'rooftop-flow-settings'
const BEST_KEY = 'rooftop-flow-best-ms'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { sensitivity: 1, motion: true, sound: true }
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      sensitivity: clamp(parsed.sensitivity ?? 1, 0.35, 2.2),
      motion: parsed.motion !== false,
      sound: parsed.sound !== false,
    }
  } catch {
    return { sensitivity: 1, motion: true, sound: true }
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Private mode can reject storage; the session still keeps the values.
  }
}

export function loadBest(): number | null {
  try {
    const raw = localStorage.getItem(BEST_KEY)
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

export function saveBest(ms: number) {
  try {
    localStorage.setItem(BEST_KEY, String(Math.round(ms)))
  } catch {
    // Ignore storage failures.
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v))
}
