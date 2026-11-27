// Reading a Weeble script project from a folder: which files belong to it, its
// entrypoint and its npm dependencies. Shared by the VS Code extension, the web
// editor and the build service, so they all agree on what gets deployed.
import type { ScriptProject } from '@weeble/api-client';

/** File types a script can import. Anything else in the folder is ignored. */
export const PROJECT_FILE_EXTENSIONS = ['.ts', '.js', '.json', '.toml', '.yaml', '.yml'];

/** Editor and package-manager files at the project root that are never deployed. */
export const WORKSPACE_SUPPORT_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'weeble.json',
]);

/** Folders that are never part of a deployment. */
export const IGNORED_DIRECTORIES = new Set(['.git', '.weeble', '.vscode', 'node_modules', 'dist']);

export interface WorkspaceFileSystem {
  readText(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

export interface ProjectDirectoryReader {
  listFiles(): Promise<string[]>;
  readText(path: string): Promise<string>;
}

/**
 * A path relative to the project, with `./` and `\` normalised away. Throws if
 * it is empty or leads outside the folder, such as `../secrets` or `/etc`.
 */
export function normalizeRelativePath(input: string, fieldName = 'path', boundaryName = 'workspace'): string {
  const replaced = input.trim().replaceAll('\\', '/');
  if (replaced.startsWith('/') || /^[a-zA-Z]:\//.test(replaced)) {
    throw new Error(`${fieldName} must stay inside the ${boundaryName}`);
  }

  const segments: string[] = [];
  for (const segment of replaced.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) throw new Error(`${fieldName} must stay inside the ${boundaryName}`);
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (segments.length === 0) throw new Error(`${fieldName} must not be empty`);
  return segments.join('/');
}

/** Whether a file is project source rather than an editor or package-manager file. */
export function isProjectFile(path: string): boolean {
  return (
    !WORKSPACE_SUPPORT_FILES.has(path) &&
    PROJECT_FILE_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension))
  );
}

/** The project's source files, sorted by path. Throws if the entrypoint is missing. */
export async function loadProjectFiles(reader: ProjectDirectoryReader, entrypoint: string): Promise<ScriptProject> {
  const normalizedEntrypoint = normalizeRelativePath(entrypoint, 'entrypoint', 'project');
  const files: Record<string, string> = {};
  for (const sourcePath of await reader.listFiles()) {
    const path = normalizeRelativePath(sourcePath, 'project file', 'project');
    if (isProjectFile(path)) files[path] = await reader.readText(sourcePath);
  }
  if (files[normalizedEntrypoint] === undefined) {
    throw new Error(`Project entrypoint does not exist: ${normalizedEntrypoint}`);
  }
  return {
    entrypoint: normalizedEntrypoint,
    files: Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))),
  };
}

/** The `dependencies` in package.json, or `fallback` when there is no package.json. */
export async function loadProjectDependencies(
  reader: ProjectDirectoryReader,
  fallback: Record<string, string> = {},
): Promise<Record<string, string>> {
  const paths = await reader.listFiles();
  if (!paths.includes('package.json')) return { ...fallback };

  let value: unknown;
  try {
    value = JSON.parse(await reader.readText('package.json'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Invalid package.json');
    throw error;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid package.json');
  }
  const dependencies = (value as { dependencies?: unknown }).dependencies;
  if (dependencies === undefined) return {};
  if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) {
    throw new Error('package.json dependencies must be an object');
  }

  const result: Record<string, string> = {};
  for (const [name, constraint] of Object.entries(dependencies)) {
    if (typeof constraint !== 'string' || constraint.trim() === '') {
      throw new Error(`Invalid dependency constraint for ${name}`);
    }
    result[name] = constraint;
  }
  return result;
}
