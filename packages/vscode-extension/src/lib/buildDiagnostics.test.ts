import { describe, expect, it } from 'vitest';
import { parseBuildDiagnostic, parseBuildDiagnostics } from './buildDiagnostics';

describe('parseBuildDiagnostic', () => {
  it('parses a file, line, and column from an esbuild-style message', () => {
    expect(parseBuildDiagnostic('src/main.ts:4:7: This import is unused')).toEqual({
      path: 'src/main.ts',
      line: 3,
      column: 6,
      message: 'This import is unused',
    });
  });

  it('accepts Windows separators without treating the drive as a location', () => {
    expect(parseBuildDiagnostic('C:\\repo\\src\\main.ts:10:2: Unexpected token')).toEqual({
      path: 'C:/repo/src/main.ts',
      line: 9,
      column: 1,
      message: 'Unexpected token',
    });
  });

  it('returns undefined for a warning without an actionable location', () => {
    expect(parseBuildDiagnostic('This import is unused')).toBeUndefined();
  });

  it('extracts actionable entries from a multiline build failure', () => {
    expect(
      parseBuildDiagnostics(
        'Build failed\nsrc/main.ts:2:5: ERROR: Expected ";"\nOne error',
      ),
    ).toEqual([
      {
        path: 'src/main.ts',
        line: 1,
        column: 4,
        message: 'ERROR: Expected ";"',
      },
    ]);
  });
});
