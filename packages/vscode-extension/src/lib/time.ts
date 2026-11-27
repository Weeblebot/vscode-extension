/** "3h ago" style time for a Unix timestamp in seconds. */
export function relativeTime(seconds: number, now = Date.now()): string {
  const elapsed = Math.max(0, Math.round(now / 1000 - seconds));
  const units: [number, string][] = [
    [60 * 60 * 24 * 365, 'y'],
    [60 * 60 * 24 * 30, 'mo'],
    [60 * 60 * 24, 'd'],
    [60 * 60, 'h'],
    [60, 'm'],
  ];
  for (const [size, unit] of units) {
    if (elapsed >= size) return `${Math.floor(elapsed / size)}${unit} ago`;
  }
  return 'just now';
}
