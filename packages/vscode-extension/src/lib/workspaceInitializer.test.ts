import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import {
  installDeploymentWorkspace,
  type WritableWorkspaceFileSystem,
} from './workspaceInitializer';

function memoryFileSystem(initial: Record<string, string> = {}) {
  const files = { ...initial };
  const fs: WritableWorkspaceFileSystem = {
    async exists(path) {
      return Object.hasOwn(files, path);
    },
    async readText(path) {
      const value = files[path];
      if (value === undefined) throw new Error(`missing ${path}`);
      return value;
    },
    async writeText(path, contents) {
      files[path] = contents;
    },
    async delete(path) {
      delete files[path];
    },
  };
  return { fs, files };
}

const sdkTypes = {
  version: '0.2.0',
  hash: 'sdk-hash',
  discord: 'declare namespace discord {}',
  runtime: 'declare namespace weeble {}',
};

describe('installDeploymentWorkspace', () => {
  it('writes deployment source directly into the opened folder', async () => {
    const { fs, files } = memoryFileSystem();

    const result = await installDeploymentWorkspace(fs, {
      name: 'Community',
      deploymentId: 'dep_123',
      guildId: 'guild_123',
      project: {
        entrypoint: 'modules/main.ts',
        files: {
          'modules/main.ts': "import ms from 'ms';",
          'tags.toml': '[welcome]\nkeywords = ["hello"]\n',
        },
      },
      packageLock: {
        ms: {
          version: '2.1.3',
          entrypoint: 'index.js',
          content_hash: 'hash',
          dependencies: {},
        },
      },
      sdkTypes,
    });

    expect(result.entrypointPath).toBe('modules/main.ts');
    expect(files['modules/main.ts']).toContain("from 'ms'");
    expect(files['tags.toml']).toContain('[welcome]');
    expect(JSON.parse(files['package.json'])).toEqual({
      name: 'weeble-community',
      private: true,
      type: 'module',
      dependencies: { ms: '2.1.3' },
    });
    expect(JSON.parse(files['.weeble/project.json'])).toMatchObject({
      version: 1,
      deployment: 'dep_123',
      entrypoint: 'modules/main.ts',
      files: ['modules/main.ts', 'tags.toml'],
      dependencies: { ms: '2.1.3' },
    });
    const settings = JSON.parse(files['.vscode/settings.json']);
    expect(settings['files.exclude']).toMatchObject({
      '.weeble': true,
      '.vscode': true,
      '**/.gitkeep': true,
      'tsconfig.json': true,
    });
    const tsconfig = JSON.parse(files['tsconfig.json']);
    expect(tsconfig.compilerOptions.baseUrl).toBeUndefined();
    expect(tsconfig.compilerOptions.ignoreDeprecations).toBeUndefined();
    expect(files['.weeble/types/modules.d.ts']).toContain("declare module 'ms'");
    expect(files['.weeble/types/modules.d.ts']).toContain("declare module '*.toml'");
    expect(files['.weeble/types/discord-module.d.ts']).toContain(
      "declare module '@weeble/sdk/discord'",
    );
    expect(files['.weeble/types/runtime-module.d.ts']).toContain(
      "declare module '@weeble/sdk/runtime'",
    );
    expect(JSON.parse(files['.weeble/sdk.json'])).toEqual({
      version: '0.2.0',
      hash: 'sdk-hash',
    });
    expect(tsconfig.compilerOptions.paths).toMatchObject({
      '@weeble/sdk/discord': ['./.weeble/types/discord-module.d.ts'],
      '@weeble/sdk/runtime': ['./.weeble/types/runtime-module.d.ts'],
    });
  });

  it('removes only source tracked by the previous deployment when switching', async () => {
    const { fs, files } = memoryFileSystem({
      '.weeble/project.json': JSON.stringify({
        version: 1,
        name: 'Old',
        deployment: 'dep_old',
        guild: 'guild_old',
        entrypoint: 'old/main.ts',
        files: ['old/main.ts', 'old/.gitkeep'],
        dependencies: {},
      }),
      'old/main.ts': 'old source',
      'old/.gitkeep': '',
      'notes.txt': 'keep me',
    });

    await installDeploymentWorkspace(fs, {
      name: 'New',
      deploymentId: 'dep_new',
      guildId: 'guild_new',
      project: {
        entrypoint: 'src/main.ts',
        files: { 'src/main.ts': 'new source' },
      },
      packageLock: {},
      sdkTypes,
    });

    expect(files['old/main.ts']).toBeUndefined();
    expect(files['old/.gitkeep']).toBeUndefined();
    expect(files['notes.txt']).toBe('keep me');
    expect(files['src/main.ts']).toBe('new source');
  });

  it('keeps a newer SDK the workspace already updated to', async () => {
    const { fs, files } = memoryFileSystem({
      '.weeble/sdk.json': JSON.stringify({ version: '2.1.0', hash: 'new-hash' }),
      '.weeble/types/lib.weeble.d.ts': 'new discord types',
      '.weeble/types/runtime.d.ts': 'new runtime types',
    });

    await installDeploymentWorkspace(fs, {
      name: 'Other',
      deploymentId: 'dep_other',
      guildId: 'guild_other',
      project: { entrypoint: 'src/main.ts', files: { 'src/main.ts': 'source' } },
      packageLock: {},
      sdkTypes: { ...sdkTypes, version: '1.4.0', hash: 'old-hash' },
    });

    expect(JSON.parse(files['.weeble/sdk.json'])).toEqual({ version: '2.1.0', hash: 'new-hash' });
    expect(files['.weeble/types/lib.weeble.d.ts']).toBe('new discord types');
    expect(files['.weeble/types/runtime.d.ts']).toBe('new runtime types');
  });

  it('replaces an older installed SDK with the bundled one', async () => {
    const { fs, files } = memoryFileSystem({
      '.weeble/sdk.json': JSON.stringify({ version: '0.1.0', hash: 'old-hash' }),
      '.weeble/types/lib.weeble.d.ts': 'old discord types',
      '.weeble/types/runtime.d.ts': 'old runtime types',
    });

    await installDeploymentWorkspace(fs, {
      name: 'Other',
      deploymentId: 'dep_other',
      guildId: 'guild_other',
      project: { entrypoint: 'src/main.ts', files: { 'src/main.ts': 'source' } },
      packageLock: {},
      sdkTypes,
    });

    expect(JSON.parse(files['.weeble/sdk.json'])).toEqual({ version: '0.2.0', hash: 'sdk-hash' });
    expect(files['.weeble/types/lib.weeble.d.ts']).toBe(sdkTypes.discord);
  });

  it('typechecks ms and TOML imports without deprecated compiler options', async () => {
    const files = await installWithRealSdk({
      entrypoint: 'modules/tag.ts',
      files: {
        'modules/tag.ts': [
          "import ms from 'ms';",
          "import tags from '../tags.toml';",
          'const delay: number = ms("5m");',
          'void delay;',
          'void tags;',
        ].join('\n'),
        'tags.toml': '[welcome]\nkeywords = ["hello"]\n',
      },
    });
    expect(await typecheck(files)).toEqual([]);
  }, 20_000);

  it('gives a new deployment a starter script that typechecks without imports', async () => {
    const files = await installWithRealSdk({ entrypoint: 'src/main.ts', files: {} });
    expect(files['src/main.ts']).toContain('discord.commands.create');
    expect(files['src/main.ts']).not.toContain('import');
    expect(await typecheck(files)).toEqual([]);
  }, 20_000);
});

/** Installs a workspace with the SDK declarations from this build (`dist/types`). */
async function installWithRealSdk(project: { entrypoint: string; files: Record<string, string> }) {
  const typesRoot = join(process.cwd(), 'dist', 'types');
  const { fs, files } = memoryFileSystem();
  await installDeploymentWorkspace(fs, {
    name: 'Tags',
    deploymentId: 'dep_tags',
    guildId: 'guild_tags',
    project,
    packageLock: {},
    sdkTypes: {
      version: '0.2.0',
      hash: 'sdk-hash',
      discord: await readFile(join(typesRoot, 'lib.weeble.d.ts'), 'utf8'),
      runtime: await readFile(join(typesRoot, 'runtime.d.ts'), 'utf8'),
    },
  });
  return files;
}

/** Writes the files to a temporary folder and returns TypeScript's errors for it. */
async function typecheck(files: Record<string, string>): Promise<string[]> {
  const root = await mkdtemp(join(tmpdir(), 'weeble-workspace-'));
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  return ts
    .getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}
