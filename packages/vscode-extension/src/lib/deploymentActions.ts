import type { BuiltArtifact, Deployment, PublishBundleInput, ScriptProject } from '@weeble/api-client';
import type { DeployProgress } from './deploymentOutput';

export interface PublishApi {
  getDeployment(deploymentId: string): Promise<Pick<Deployment, 'current_revision' | 'active_revision'>>;
  publishBundle(
    deploymentId: string,
    input: PublishBundleInput,
  ): Promise<{ created: boolean; revision: { revision: number } }>;
  activateDeployment(deploymentId: string, revision?: number): Promise<unknown>;
}

/**
 * - `deployed`: a new revision was published and is live.
 * - `activated-existing`: the code matched an earlier revision, which is live again.
 * - `unchanged`: the code matched the revision that was already live.
 */
export type PublishOutcome = 'deployed' | 'activated-existing' | 'unchanged';

export interface PublishOptions {
  build(project: ScriptProject, dependencies: Record<string, string>, signal?: AbortSignal): Promise<BuiltArtifact>;
  api: PublishApi;
  releaseNote: string;
  /** Recorded with the revision, such as `vscode-extension@0.8.0`. */
  workspaceVersion: string;
  onProgress?: (event: DeployProgress) => void;
  signal?: AbortSignal;
}

/** Builds the project, publishes it as a revision of the deployment and makes that revision live. */
export async function publishProject(
  deploymentId: string,
  projectName: string,
  project: ScriptProject,
  dependencies: Record<string, string>,
  options: PublishOptions,
): Promise<{ revision: number; warnings: string[]; outcome: PublishOutcome }> {
  const buildStartedAt = Date.now();
  options.onProgress?.({ stage: 'building', projectName });
  const [built, deployment] = await Promise.all([
    options.build(project, dependencies, options.signal),
    options.api.getDeployment(deploymentId),
  ]);
  throwIfAborted(options.signal);
  options.onProgress?.({ stage: 'built', durationMs: Date.now() - buildStartedAt, warnings: built.warnings.length });

  options.onProgress?.({ stage: 'publishing' });
  const published = await options.api.publishBundle(deploymentId, {
    project: built.project,
    userBundle: built.code,
    sourceMap: built.sourceMap,
    expectedRevision: deployment.current_revision,
    packageLock: built.packageLock,
    releaseNote: options.releaseNote,
    source: { workspaceVersion: options.workspaceVersion, artifactHash: built.artifactHash },
  });
  const revision = published.revision.revision;
  options.onProgress?.({ stage: 'published', revision });

  const result = { revision, warnings: built.warnings };
  if (deployment.active_revision === revision) {
    return { ...result, outcome: published.created ? 'deployed' : 'unchanged' };
  }
  options.onProgress?.({ stage: 'activating', revision });
  await options.api.activateDeployment(deploymentId, revision);
  return { ...result, outcome: published.created ? 'deployed' : 'activated-existing' };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error('Deployment cancelled');
}
