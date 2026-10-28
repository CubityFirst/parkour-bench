export enum GameState {
  Loading = 'loading',
  Menu = 'menu',
  Playing = 'playing',
  Paused = 'paused',
  Finished = 'finished',
}

/** Format seconds as MM:SS.CC */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
