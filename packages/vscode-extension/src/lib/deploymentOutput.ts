export type DeployProgress =
  | { stage: 'building'; projectName: string }
  | { stage: 'changes'; added: number; modified: number; deleted: number }
  | { stage: 'built'; durationMs: number; warnings: number }
  | { stage: 'publishing' }
  | { stage: 'published'; revision: number }
  | { stage: 'activating'; revision: number };

export function formatDeployProgress(event: DeployProgress): string {
  switch (event.stage) {
    case 'building':
      return `Building ${event.projectName}…`;
    case 'changes':
      return `Workspace changes · ${event.added} added · ${event.modified} modified · ${event.deleted} deleted`;
    case 'built':
      return `Bundle completed in ${formatDuration(event.durationMs)} · ${warningCount(event.warnings)}`;
    case 'publishing':
      return 'Publishing revision…';
    case 'published':
      return `Published revision ${event.revision}`;
    case 'activating':
      return `Activating revision ${event.revision}…`;
  }
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function warningCount(count: number): string {
  return `${count} warning${count === 1 ? '' : 's'}`;
}
