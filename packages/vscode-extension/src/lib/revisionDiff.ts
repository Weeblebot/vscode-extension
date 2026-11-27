import type { ScriptProject } from '@weeble/api-client';

export type RevisionFileStatus = 'added' | 'modified' | 'deleted';

export interface RevisionFileChange {
  path: string;
  status: RevisionFileStatus;
  before: string;
  after: string;
}

export function compareRevisionProjects(
  previous: ScriptProject | undefined,
  current: ScriptProject,
): RevisionFileChange[] {
  const beforeFiles = previous?.files ?? {};
  const paths = new Set([...Object.keys(beforeFiles), ...Object.keys(current.files)]);
  const changes: RevisionFileChange[] = [];

  for (const path of [...paths].sort()) {
    const before = beforeFiles[path];
    const after = current.files[path];
    if (before === after) continue;
    changes.push({
      path,
      status:
        before === undefined ? 'added' : after === undefined ? 'deleted' : 'modified',
      before: before ?? '',
      after: after ?? '',
    });
  }
  return changes;
}
