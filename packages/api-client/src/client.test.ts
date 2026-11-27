import { describe, expect, it, vi } from 'vitest';
import { WeebleApiClient, WeebleApiError } from './index';

describe('WeebleApiClient', () => {
  it('creates and exchanges a device authorization', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            device_code: 'device-code',
            user_code: 'ABCD-EFGH',
            verification_uri: 'https://weeble.works/device',
            expires_in: 600,
            interval: 5,
            scopes: ['deployments:read'],
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          token_id: 'dev_1',
          access_token: 'wbl_token',
          token_type: 'Bearer',
          client_name: 'CLI',
          scopes: ['deployments:read'],
          expires_at: 1234,
        }),
      );
    const client = new WeebleApiClient({ baseUrl: 'https://api.weeble.works', fetcher });

    const device = await client.createDeviceAuthorization('CLI', ['deployments:read']);
    const token = await client.exchangeDeviceAuthorization(device.deviceCode);

    expect(device.userCode).toBe('ABCD-EFGH');
    expect(token.accessToken).toBe('wbl_token');
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://api.weeble.works/auth/device',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          client_name: 'CLI',
          scopes: ['deployments:read'],
        }),
      }),
    );
  });

  it('sends the developer bearer token on authenticated calls', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        user: {
          user_id: 'tester',
          username: 'tester',
          avatar: null,
          is_staff: false,
          auth_kind: 'developer',
          scopes: ['deployments:read'],
        },
      }),
    );
    const client = new WeebleApiClient({
      baseUrl: 'https://api.weeble.works/',
      accessToken: 'wbl_token',
      fetcher,
    });

    await client.session();

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.weeble.works/auth/session',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer wbl_token',
        }),
      }),
    );
  });

  it('exposes API errors with status and detail', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ detail: 'authorization_pending' }, { status: 428 }));
    const client = new WeebleApiClient({ baseUrl: 'https://api.weeble.works', fetcher });

    await expect(client.exchangeDeviceAuthorization('pending')).rejects.toMatchObject({
      name: 'WeebleApiError',
      status: 428,
      detail: 'authorization_pending',
    } satisfies Partial<WeebleApiError>);
  });

  it('publishes a bundle and activates a deployment', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          created: true,
          revision: { deployment_id: 'dep_1', revision: 4 },
          deployment: { id: 'dep_1', current_revision: 4 },
          runtime: {},
          gateway: { synced: false },
          commands: null,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          deployment: { id: 'dep_1', current_revision: 4, active_revision: 4 },
        }),
      );
    const client = new WeebleApiClient({
      baseUrl: 'https://api.weeble.works',
      accessToken: 'wbl_token',
      fetcher,
    });

    const published = await client.publishBundle('dep_1', {
      project: { entrypoint: 'main.ts', files: { 'main.ts': 'export {};' } },
      userBundle: '(() => {})();',
      sourceMap: '{"version":3}',
      expectedRevision: 3,
      packageLock: {},
      releaseNote: 'Ship it',
    });
    const activated = await client.activateDeployment('dep_1', 4);

    expect(published.created).toBe(true);
    expect(published.revision.revision).toBe(4);
    expect(activated.active_revision).toBe(4);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://api.weeble.works/deployments/dep_1/publish-bundle',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"release_note":"Ship it"'),
      }),
    );
    expect(fetcher.mock.calls[0]?.[1]?.body).toContain('"source_map":"{\\"version\\":3}"');
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://api.weeble.works/deployments/dep_1/activate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ revision: 4 }),
      }),
    );
  });

  it('writes KV values with an expected CAS version', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        item: {
          namespace: 'settings',
          key: 'welcome',
          value: { enabled: true },
          cas_version: 8,
          ttl_ms: null,
        },
      }),
    );
    const client = new WeebleApiClient({
      baseUrl: 'https://api.weeble.works',
      accessToken: 'wbl_token',
      fetcher,
    });

    const item = await client.putKv('dep_1', {
      namespace: 'settings',
      key: 'welcome',
      value: { enabled: true },
      ttlMs: null,
      expectedCasVersion: 7,
    });

    expect(item.cas_version).toBe(8);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.weeble.works/deployments/dep_1/kv',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          namespace: 'settings',
          key: 'welcome',
          value: { enabled: true },
          ttl_ms: null,
          expected_cas_version: 7,
        }),
      }),
    );
  });

  it('deletes a complete KV namespace in one request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ deleted: 3 }));
    const client = new WeebleApiClient({
      baseUrl: 'https://api.weeble.works',
      accessToken: 'wbl_token',
      fetcher,
    });

    await expect(client.deleteKvNamespace('dep_1', 'user names')).resolves.toBe(3);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.weeble.works/deployments/dep_1/kv/user%20names',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('requests one exact npm package version for review', async () => {
    const request = {
      id: 'pkgr_1',
      name: 'date-fns',
      version: '4.1.0',
      requester_id: 'user_1',
      status: 'pending' as const,
      scan: { compatible: true, package_count: 1, artifacts: [] },
      created_at: 1,
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ request }));
    const client = new WeebleApiClient({
      baseUrl: 'https://api.weeble.works',
      accessToken: 'wbl_token',
      fetcher,
    });

    await expect(client.requestPackage('date-fns', '4.1.0')).resolves.toEqual(request);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.weeble.works/packages/requests',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'date-fns', version: '4.1.0' }),
      }),
    );
  });
});
