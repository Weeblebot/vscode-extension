import { describe, expect, it, vi } from 'vitest';
import { WeebleApiError, type DeveloperToken, type DeviceAuthorization } from '@weeble/api-client';
import { pollDeviceAuthorization, type DeviceLoginApi } from './deviceLogin';

const device: DeviceAuthorization = {
  deviceCode: 'device',
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://weeble.works/device',
  expiresIn: 30,
  interval: 1,
  scopes: ['deployments:read'],
};

const token: DeveloperToken = {
  tokenId: 'dev_1',
  accessToken: 'wbl_token',
  tokenType: 'Bearer',
  clientName: 'VS Code',
  scopes: ['deployments:read'],
  expiresAt: 1234,
};

describe('pollDeviceAuthorization', () => {
  it('retries authorization_pending and returns the issued token', async () => {
    const api: DeviceLoginApi = {
      createDeviceAuthorization: vi.fn(),
      exchangeDeviceAuthorization: vi
        .fn()
        .mockRejectedValueOnce(new WeebleApiError(428, 'authorization_pending'))
        .mockResolvedValueOnce(token),
    };
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      pollDeviceAuthorization(api, device, { sleep, now: () => 0 }),
    ).resolves.toEqual(token);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('does not retry terminal API errors', async () => {
    const api: DeviceLoginApi = {
      createDeviceAuthorization: vi.fn(),
      exchangeDeviceAuthorization: vi
        .fn()
        .mockRejectedValue(new WeebleApiError(400, 'device_code_consumed')),
    };

    await expect(
      pollDeviceAuthorization(api, device, {
        sleep: vi.fn(),
        now: () => 0,
      }),
    ).rejects.toMatchObject({ detail: 'device_code_consumed' });
  });

  it('stops polling after the device authorization expires', async () => {
    const api: DeviceLoginApi = {
      createDeviceAuthorization: vi.fn(),
      exchangeDeviceAuthorization: vi
        .fn()
        .mockRejectedValue(new WeebleApiError(428, 'authorization_pending')),
    };
    let now = 0;

    await expect(
      pollDeviceAuthorization(api, device, {
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
        now: () => now,
      }),
    ).rejects.toThrow('Device authorization expired');
  });
});
