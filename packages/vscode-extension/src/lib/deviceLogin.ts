import {
  WeebleApiError,
  type DeveloperToken,
  type DeviceAuthorization,
} from '@weeble/api-client';

export interface DeviceLoginApi {
  createDeviceAuthorization(
    clientName: string,
    scopes: string[],
  ): Promise<DeviceAuthorization>;
  exchangeDeviceAuthorization(deviceCode: string): Promise<DeveloperToken>;
}

export interface DevicePollingOptions {
  sleep(milliseconds: number): Promise<void>;
  now(): number;
}

export async function pollDeviceAuthorization(
  api: DeviceLoginApi,
  device: DeviceAuthorization,
  options: DevicePollingOptions = {
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: () => Date.now(),
  },
): Promise<DeveloperToken> {
  const deadline = options.now() + device.expiresIn * 1000;
  while (options.now() < deadline) {
    try {
      return await api.exchangeDeviceAuthorization(device.deviceCode);
    } catch (error) {
      if (!(error instanceof WeebleApiError) || error.detail !== 'authorization_pending') {
        throw error;
      }
    }
    await options.sleep(device.interval * 1000);
  }
  throw new Error('Device authorization expired');
}
