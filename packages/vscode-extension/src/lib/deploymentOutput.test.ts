import { describe, expect, it } from 'vitest';
import { formatDeployProgress, formatDuration } from './deploymentOutput';

describe('deployment output', () => {
  it('formats concise deployment stages', () => {
    expect(formatDeployProgress({ stage: 'building', projectName: 'Community Bot' })).toBe(
      'Building Community Bot…',
    );
    expect(formatDeployProgress({
      stage: 'changes',
      added: 1,
      modified: 2,
      deleted: 0,
    })).toBe('Workspace changes · 1 added · 2 modified · 0 deleted');
    expect(formatDeployProgress({ stage: 'built', durationMs: 842, warnings: 2 })).toBe(
      'Bundle completed in 842 ms · 2 warnings',
    );
    expect(formatDeployProgress({ stage: 'publishing' })).toBe(
      'Publishing revision…',
    );
    expect(formatDeployProgress({ stage: 'published', revision: 588 })).toBe(
      'Published revision 588',
    );
    expect(formatDeployProgress({ stage: 'activating', revision: 588 })).toBe(
      'Activating revision 588…',
    );
  });

  it('formats durations without false precision', () => {
    expect(formatDuration(842)).toBe('842 ms');
    expect(formatDuration(2_140)).toBe('2.1 s');
  });
});
