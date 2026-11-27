import { describe, expect, it, vi } from 'vitest';
import { requestBuild } from './buildClient';

describe('requestBuild', () => {
  it('reports an unreachable build service clearly', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      requestBuild(fetcher, 'https://build.weeble.works', 'token', {
        project: { entrypoint: 'src/main.ts', files: { 'src/main.ts': '' } },
        dependencies: {},
      }),
    ).rejects.toThrow(
      "Couldn't reach the Weeble build service at https://build.weeble.works",
    );
  });

  it('passes cancellation to the build request and preserves its reason', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      expect(init?.signal).toBe(controller.signal);
      controller.abort(new Error('Deployment cancelled'));
      throw controller.signal.reason;
    });

    await expect(
      requestBuild(
        fetcher,
        'https://build.weeble.works',
        'token',
        {
          project: { entrypoint: 'main.ts', files: { 'main.ts': '' } },
          dependencies: {},
        },
        controller.signal,
      ),
    ).rejects.toThrow('Deployment cancelled');
  });
});
