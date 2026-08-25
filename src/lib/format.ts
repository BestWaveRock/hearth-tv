/** Small formatting helpers, kept pure so they are trivially testable. */

/** `3725` -> `1:02:05`; `95` -> `1:35`. Used everywhere a duration appears. */
export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Spoken-word duration for metadata lines: "1 h 47 min". */
export function formatRuntime(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatBytes(bytes: number | null | undefined): string | null {
  if (!bytes || !Number.isFinite(bytes)) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatClock(date: Date, use24h: boolean): string {
  return date.toLocaleTimeString(undefined, {
    hour: use24h ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: !use24h,
  });
}

export function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** "just now" / "3 h ago" / "12 Mar" — for Continue Watching subtitles. */
export function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** A stable hue from any string, used to colour placeholder artwork. */
export function hueFrom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  // Bias towards the warm half of the wheel so placeholders stay on-palette.
  return ((hash % 90) + 90) % 90 + 340 - 45;
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Winding down';
}
