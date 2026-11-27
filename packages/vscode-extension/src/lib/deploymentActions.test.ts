import { describe, expect, it, vi } from 'vitest';
import { publishProject, type PublishApi, type PublishOptions } from './deploymentActions';

const files = { entrypoint: 'main.ts', files: { 'main.ts': 'export {};' } };

function built(warnings: string[] = []) {
  return { code: 'bundle', sourceMap: '{}', warnings, project: files, packageLock: {}, artifactHash: 'hash' };
}

/** A deployment whose live revision is `active`, where publishing returns `revision`. */
function api(active: number, revision: number, created = true) {
  return {
    getDeployment: vi.fn().mockResolvedValue({ current_revision: 7, active_revision: active }),
    publishBundle: vi.fn().mockResolvedValue({ created, revision: { revision } }),
    activateDeployment: vi.fn().mockResolvedValue({}),
  } satisfies PublishApi;
}

function publish(publishApi: PublishApi, options: Partial<PublishOptions> = {}) {
  return publishProject('dep_1', 'community', files, {}, {
    build: vi.fn().mockResolvedValue(built()),
    api: publishApi,
    releaseNote: 'release',
    workspaceVersion: 'vscode-extension@1.2.3',
    ...options,
  });
}

describe('publishProject', () => {
  it('builds, publishes and makes the new revision live', async () => {
    const deployment = api(7, 8);
    const result = await publish(deployment);

    expect(result).toEqual({ revision: 8, warnings: [], outcome: 'deployed' });
    expect(deployment.publishBundle).toHaveBeenCalledWith(
      'dep_1',
      expect.objectContaining({
        expectedRevision: 7,
        userBundle: 'bundle',
        releaseNote: 'release',
        source: { workspaceVersion: 'vscode-extension@1.2.3', artifactHash: 'hash' },
      }),
    );
    expect(deployment.activateDeployment).toHaveBeenCalledWith('dep_1', 8);
  });

  it('returns the build warnings', async () => {
    const result = await publish(api(7, 8), {
      build: vi.fn().mockResolvedValue(built(['src/main.ts:4:7: This import is unused'])),
    });
    expect(result.warnings).toEqual(['src/main.ts:4:7: This import is unused']);
  });

  it('reports each stage', async () => {
    const onProgress = vi.fn();
    await publish(api(7, 8), { onProgress });
    expect(onProgress.mock.calls.map(([event]) => event)).toEqual([
      { stage: 'building', projectName: 'community' },
      { stage: 'built', durationMs: expect.any(Number), warnings: 0 },
      { stage: 'publishing' },
      { stage: 'published', revision: 8 },
      { stage: 'activating', revision: 8 },
    ]);
  });

  it('does not publish when cancelled during the build', async () => {
    const controller = new AbortController();
    const deployment = api(7, 8);
    const build = vi.fn(async () => {
      controller.abort(new Error('Deployment cancelled'));
      return built();
    });
    await expect(publish(deployment, { build, signal: controller.signal })).rejects.toThrow('Deployment cancelled');
    expect(deployment.publishBundle).not.toHaveBeenCalled();
  });

  it('does nothing more when the code matches the live revision', async () => {
    const deployment = api(4, 4, false);
    expect((await publish(deployment)).outcome).toBe('unchanged');
    expect(deployment.activateDeployment).not.toHaveBeenCalled();
  });

  it('makes an earlier matching revision live again', async () => {
    const deployment = api(7, 4, false);
    expect((await publish(deployment)).outcome).toBe('activated-existing');
    expect(deployment.activateDeployment).toHaveBeenCalledWith('dep_1', 4);
  });
});
