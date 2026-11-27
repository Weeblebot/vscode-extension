import { describe, expect, it } from 'vitest';
import { relativeTime } from './time';

describe('relativeTime', () => {
  const now = Date.UTC(2026, 0, 10, 12, 0, 0);
  const secondsAgo = (seconds: number) => now / 1000 - seconds;

  it('uses the largest whole unit', () => {
    expect(relativeTime(secondsAgo(30), now)).toBe('just now');
    expect(relativeTime(secondsAgo(5 * 60), now)).toBe('5m ago');
    expect(relativeTime(secondsAgo(3 * 60 * 60 + 59 * 60), now)).toBe('3h ago');
    expect(relativeTime(secondsAgo(2 * 24 * 60 * 60), now)).toBe('2d ago');
    expect(relativeTime(secondsAgo(400 * 24 * 60 * 60), now)).toBe('1y ago');
  });

  it('treats future times as now', () => {
    expect(relativeTime(secondsAgo(-60), now)).toBe('just now');
  });
});
