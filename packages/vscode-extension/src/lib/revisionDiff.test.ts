import { describe, expect, it } from 'vitest';
import { compareRevisionProjects } from './revisionDiff';

describe('compareRevisionProjects', () => {
  it('reports added, modified, and deleted files', () => {
    expect(
      compareRevisionProjects(
        {
          entrypoint: 'main.ts',
          files: {
            'deleted.ts': 'old',
            'main.ts': 'before',
            'same.json': '{}',
          },
        },
        {
          entrypoint: 'main.ts',
          files: {
            'added.ts': 'new',
            'main.ts': 'after',
            'same.json': '{}',
          },
        },
      ),
    ).toEqual([
      { path: 'added.ts', status: 'added', before: '', after: 'new' },
      { path: 'deleted.ts', status: 'deleted', before: 'old', after: '' },
      { path: 'main.ts', status: 'modified', before: 'before', after: 'after' },
    ]);
  });

  it('compares the first revision against an empty project', () => {
    expect(
      compareRevisionProjects(undefined, {
        entrypoint: 'src/main.ts',
        files: { 'src/main.ts': 'hello' },
      }),
    ).toEqual([
      {
        path: 'src/main.ts',
        status: 'added',
        before: '',
        after: 'hello',
      },
    ]);
  });
});
