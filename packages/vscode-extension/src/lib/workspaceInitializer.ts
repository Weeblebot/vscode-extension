import { normalizeRelativePath } from '@weeble/project';
import type { PackageLock, ScriptProject } from '@weeble/api-client';
import { PROJECT_FILE } from './project';
import { hasSdkUpdate, installSdkRelease, readInstalledSdk, type SdkRelease } from './sdkUpdate';

export interface WritableWorkspaceFileSystem {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  delete(path: string): Promise<void>;
}

export interface DeploymentWorkspaceInput {
  name: string;
  deploymentId: string;
  guildId: string;
  project: ScriptProject;
  packageLock: PackageLock;
  /** The SDK declarations bundled with the extension. */
  sdkTypes: SdkRelease;
}

export interface DeploymentWorkspaceResult {
  entrypointPath: string;
}

export async function installDeploymentWorkspace(
  fs: WritableWorkspaceFileSystem,
  input: DeploymentWorkspaceInput,
): Promise<DeploymentWorkspaceResult> {
  const previous = await readPreviousMetadata(fs);
  for (const path of previous?.files ?? []) {
    const normalized = normalizeRelativePath(path, 'managed file', 'workspace');
    if (await fs.exists(normalized)) await fs.delete(normalized);
  }

  const sourceFiles =
    Object.keys(input.project.files).length > 0
      ? input.project.files
      : { [input.project.entrypoint]: STARTER_SOURCE };
  const normalizedSources = Object.fromEntries(
    Object.entries(sourceFiles).map(([path, source]) => [
      normalizeRelativePath(path, 'deployment file', 'workspace'),
      source,
    ]),
  );
  const managedFiles = Object.keys(normalizedSources).sort();
  for (const path of managedFiles) {
    await fs.writeText(path, normalizedSources[path]);
  }

  const dependencies = Object.fromEntries(
    Object.entries(input.packageLock).map(([name, metadata]) => [name, metadata.version]),
  );
  const entrypoint = normalizeRelativePath(
    input.project.entrypoint,
    'entrypoint',
    'workspace',
  );
  await fs.writeText(
    PROJECT_FILE,
    formatJson({
      version: 1,
      name: input.name,
      deployment: input.deploymentId,
      guild: input.guildId,
      entrypoint,
      files: managedFiles,
      dependencies,
    }),
  );
  await installWorkspaceSupport(fs, input.name, dependencies, input.sdkTypes);
  return { entrypointPath: entrypoint };
}

/** SDK types, tsconfig, package.json and editor settings, for a script project. */
export async function installWorkspaceSupport(
  fs: WritableWorkspaceFileSystem,
  name: string,
  dependencies: Record<string, string>,
  sdkTypes: SdkRelease,
): Promise<void> {
  // The SDK bundled with the extension can be older than one the workspace
  // already updated to. Keep the installed SDK unless the bundled one is newer.
  if (await shouldInstallBundledSdk(fs, sdkTypes)) await installSdkRelease(fs, sdkTypes);
  await fs.writeText('.weeble/types/discord-module.d.ts', DISCORD_MODULE_TYPES);
  await fs.writeText('.weeble/types/runtime-module.d.ts', RUNTIME_MODULE_TYPES);
  await fs.writeText('.weeble/types/modules.d.ts', COMMON_MODULE_TYPES);
  await fs.writeText('tsconfig.json', formatJson(TSCONFIG));
  await fs.writeText(
    'package.json',
    formatJson({
      name: `weeble-${projectPackageName(name)}`,
      private: true,
      type: 'module',
      dependencies,
    }),
  );
  await writeEditorSettings(fs);
}

async function shouldInstallBundledSdk(
  fs: WritableWorkspaceFileSystem,
  bundled: SdkRelease,
): Promise<boolean> {
  const installed = await readInstalledSdk(fs);
  if (!installed) return true;
  if (!(await fs.exists('.weeble/types/lib.weeble.d.ts'))) return true;
  if (!(await fs.exists('.weeble/types/runtime.d.ts'))) return true;
  return hasSdkUpdate(installed, bundled);
}

async function readPreviousMetadata(fs: WritableWorkspaceFileSystem) {
  if (!(await fs.exists(PROJECT_FILE))) return undefined;
  const value = JSON.parse(await fs.readText(PROJECT_FILE)) as {
    files?: unknown;
  };
  return {
    files: Array.isArray(value.files)
      ? value.files.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

async function writeEditorSettings(fs: WritableWorkspaceFileSystem) {
  let settings: Record<string, unknown> = {};
  if (await fs.exists('.vscode/settings.json')) {
    try {
      settings = JSON.parse(await fs.readText('.vscode/settings.json'));
    } catch {
      settings = {};
    }
  }
  const excludes =
    typeof settings['files.exclude'] === 'object' && settings['files.exclude'] !== null
      ? (settings['files.exclude'] as Record<string, boolean>)
      : {};
  settings['files.exclude'] = {
    ...excludes,
    '.weeble': true,
    '.vscode': true,
    '**/.gitkeep': true,
    'tsconfig.json': true,
  };
  await fs.writeText('.vscode/settings.json', formatJson(settings));
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function projectPackageName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'script';
}

// `discord` and `weeble` are globals, so a new script needs no imports.
const STARTER_SOURCE = `const commands = discord.commands.create({ prefixes: ['!'] });

commands.prefix({ name: 'ping', description: 'Check the bot is up' }, async (message) => {
  await message.reply('pong');
});
`;

// Older scripts import the globals from these modules, so they still resolve.
const DISCORD_MODULE_TYPES = `/// <reference path="./lib.weeble.d.ts" />
declare module '@weeble/discord' {
  const api: typeof discord;
  export default api;
}

declare module '@weeble/sdk/discord' {
  const api: typeof discord;
  export default api;
}
`;

const RUNTIME_MODULE_TYPES = `/// <reference path="./runtime.d.ts" />
declare module '@weeble/runtime' {
  const api: typeof weeble;
  export default api;
}

declare module '@weeble/sdk/runtime' {
  const api: typeof weeble;
  export default api;
}
`;

// `ms` is built into the runtime, so scripts can import it without adding it as a package.
const COMMON_MODULE_TYPES = `declare module 'ms' {
  type StringValue = \`\${number}\${string}\`;
  interface Options { long?: boolean }
  function ms(value: StringValue): number;
  function ms(value: number, options?: Options): string;
  namespace ms { export { StringValue, Options }; }
  export default ms;
}

declare module '*.toml' {
  const value: unknown;
  export default value;
}

declare module '*.yaml' {
  const value: unknown;
  export default value;
}

declare module '*.yml' {
  const value: unknown;
  export default value;
}
`;

const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    strict: true,
    noEmit: true,
    lib: ['ES2022'],
    skipLibCheck: true,
    resolveJsonModule: true,
    allowArbitraryExtensions: true,
    paths: {
      '@weeble/discord': ['./.weeble/types/discord-module.d.ts'],
      '@weeble/runtime': ['./.weeble/types/runtime-module.d.ts'],
      '@weeble/sdk/discord': ['./.weeble/types/discord-module.d.ts'],
      '@weeble/sdk/runtime': ['./.weeble/types/runtime-module.d.ts'],
    },
  },
  include: ['**/*.ts', '.weeble/types/**/*.d.ts'],
  exclude: ['node_modules', '.git'],
};
