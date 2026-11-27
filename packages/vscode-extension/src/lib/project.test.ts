import { describe, expect, it } from 'vitest';
import type { WorkspaceFileSystem } from '@weeble/project';
import { readProject } from './project';

function memoryFileSystem(files: Record<string, string>): WorkspaceFileSystem {
  return {
    async readText(path) {
      const value = files[path];
      if (value === undefined) throw new Error(`missing ${path}`);
      return value;
    },
    async exists(path) {
      return Object.hasOwn(files, path);
    },
  };
}

const metadata = {
  version: 1,
  name: 'Community',
  deployment: 'dep_community',
  guild: 'guild_1',
  entrypoint: 'src/main.ts',
  files: ['src/main.ts'],
  dependencies: { ms: '2.1.3' },
};

describe('readProject', () => {
  it('reads the connected deployment', async () => {
    const project = await readProject(
      memoryFileSystem({ '.weeble/project.json': JSON.stringify(metadata), 'src/main.ts': '' }),
    );

    expect(project).toEqual({
      name: 'Community',
      deployment: 'dep_community',
      guild: 'guild_1',
      entrypoint: 'src/main.ts',
      files: ['src/main.ts'],
      dependencies: { ms: '2.1.3' },
    });
  });

  it('returns undefined before a deployment is selected', async () => {
    expect(await readProject(memoryFileSystem({}))).toBeUndefined();
  });

  it('rejects a missing entrypoint', async () => {
    await expect(
      readProject(memoryFileSystem({ '.weeble/project.json': JSON.stringify(metadata) })),
    ).rejects.toThrow('entrypoint does not exist');
  });
});
