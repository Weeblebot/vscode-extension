import { IGNORED_DIRECTORIES, isProjectFile } from '@weeble/project';

export function normalizeEntrypointPath(raw: string): string | undefined {
  const path = raw.replace(/\\/g, '/').trim().replace(/^\.\//, '').replace(/^\/+/, '');
  if (!path) return undefined;
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return undefined;
  }
  return path;
}

export function entrypointCandidates(paths: string[]): string[] {
  const candidates = new Set<string>();
  for (const raw of paths) {
    const path = normalizeEntrypointPath(raw);
    if (!path) continue;
    // The same files a deploy would include, so the entrypoint is always one of them.
    if (IGNORED_DIRECTORIES.has(path.split('/')[0]!) || !isProjectFile(path)) continue;
    candidates.add(path);
  }
  return [...candidates].sort((left, right) => left.localeCompare(right));
}

export function updateProjectEntrypoint(source: string, entrypoint: string): string {
  const normalized = normalizeEntrypointPath(entrypoint);
  if (!normalized) throw new Error(`Invalid entrypoint path: ${entrypoint}`);
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('Invalid .weeble/project.json');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid .weeble/project.json');
  }
  const record = value as Record<string, unknown>;
  const files = Array.isArray(record.files)
    ? record.files.filter((item): item is string => typeof item === 'string')
    : [];
  if (!files.includes(normalized)) files.push(normalized);
  files.sort((left, right) => left.localeCompare(right));
  return `${JSON.stringify({ ...record, entrypoint: normalized, files }, null, 2)}\n`;
}
