import { describe, expect, it } from 'vitest';
import {
  loadProjectDependencies,
  loadProjectFiles,
  type ProjectDirectoryReader,
} from './index';

function reader(entries: Record<string, string>): ProjectDirectoryReader {
  return {
    async listFiles() {
      return Object.keys(entries);
    },
    async readText(path) {
      const value = entries[path];
      if (value === undefined) throw new Error(`missing ${path}`);
      return value;
    },
  };
}

describe('loadProjectFiles', () => {
  it('loads supported project source and data files', async () => {
    const project = await loadProjectFiles(
      reader({
        'src/main.ts': 'import config from "./config.json";',
        'src/config.json': '{"enabled":true}',
        'package.json': '{"dependencies":{"nanoid":"^5.0.0"}}',
        'package-lock.json': '{"lockfileVersion":3}',
        'npm-shrinkwrap.json': '{"lockfileVersion":3}',
        'pnpm-lock.yaml': 'lockfileVersion: 9',
        'tsconfig.json': '{"compilerOptions":{"strict":true}}',
        'README.md': '# ignored',
        'weeble.json': '{}',
      }),
      'src/main.ts',
    );

    expect(project).toEqual({
      entrypoint: 'src/main.ts',
      files: {
        'src/config.json': '{"enabled":true}',
        'src/main.ts': 'import config from "./config.json";',
      },
    });
  });

  it('loads runtime dependency constraints from package.json', async () => {
    const dependencies = await loadProjectDependencies(
      reader({
        'package.json': JSON.stringify({
          dependencies: { nanoid: '^5.0.0' },
          devDependencies: { typescript: '^5.9.0' },
        }),
      }),
      { ms: '2.1.3' },
    );

    expect(dependencies).toEqual({ nanoid: '^5.0.0' });
  });

  it('uses existing dependency constraints when package.json is absent', async () => {
    const dependencies = await loadProjectDependencies(
      reader({ 'src/main.ts': '' }),
      { ms: '2.1.3' },
    );

    expect(dependencies).toEqual({ ms: '2.1.3' });
  });

  it('rejects files that escape the project directory', async () => {
    await expect(
      loadProjectFiles(reader({ '../secret.ts': 'secret' }), 'main.ts'),
    ).rejects.toThrow('must stay inside the project');
  });

  it('requires the configured entrypoint to exist', async () => {
    await expect(
      loadProjectFiles(reader({ 'src/other.ts': '' }), 'src/main.ts'),
    ).rejects.toThrow('Project entrypoint does not exist: src/main.ts');
  });
});
