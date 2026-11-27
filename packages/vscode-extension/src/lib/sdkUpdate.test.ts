import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  downloadSdkRelease,
  hasSdkUpdate,
  installSdkRelease,
  isMajorSdkUpdate,
  readInstalledSdk,
  sdkManifestUrl,
  type SdkUpdateFileSystem,
} from './sdkUpdate';

function hashTypes(discord: string, runtime: string): string {
  return createHash('sha256').update(discord).update('\0').update(runtime).digest('hex');
}

function memoryFileSystem(initial: Record<string, string> = {}) {
  const files = { ...initial };
  const fs: SdkUpdateFileSystem = {
    async exists(path) {
      return Object.hasOwn(files, path);
    },
    async readText(path) {
      const value = files[path];
      if (value === undefined) throw new Error(`missing ${path}`);
      return value;
    },
    async writeText(path, contents) {
      files[path] = contents;
    },
  };
  return { fs, files };
}

describe('SDK updates', () => {
  it('builds the manifest URL from the configured API origin', () => {
    expect(sdkManifestUrl('https://api.example.test/base')).toBe(
      'https://api.example.test/sdk/manifest.json',
    );
  });
  it('downloads and verifies same-origin SDK declarations', async () => {
    const discord = 'declare namespace discord {}';
    const runtime = 'declare namespace weeble {}';
    const hash = hashTypes(discord, runtime);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) {
        return Response.json({
          version: '0.2.0',
          hash,
          discord: 'lib.weeble.d.ts',
          runtime: 'runtime.d.ts',
        });
      }
      if (url.endsWith('/lib.weeble.d.ts')) return new Response(discord);
      if (url.endsWith('/runtime.d.ts')) return new Response(runtime);
      return new Response('missing', { status: 404 });
    });

    await expect(
      downloadSdkRelease(fetcher, 'https://weeble.works/sdk/manifest.json'),
    ).resolves.toEqual({ version: '0.2.0', hash, discord, runtime });
  });

  it('rejects cross-origin files and invalid hashes', async () => {
    const crossOrigin = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/manifest.json')) {
        return Response.json({
          version: '0.2.0',
          hash: '0'.repeat(64),
          discord: 'https://example.com/lib.weeble.d.ts',
          runtime: 'runtime.d.ts',
        });
      }
      return new Response('types');
    });
    await expect(
      downloadSdkRelease(crossOrigin, 'https://weeble.works/sdk/manifest.json'),
    ).rejects.toThrow('same origin');

    const invalidHash = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/manifest.json')) {
        return Response.json({
          version: '0.2.0',
          hash: 'bad',
          discord: 'lib.weeble.d.ts',
          runtime: 'runtime.d.ts',
        });
      }
      return new Response('types');
    });
    await expect(
      downloadSdkRelease(invalidHash, 'https://weeble.works/sdk/manifest.json'),
    ).rejects.toThrow('integrity');
  });

  it('tracks and installs SDK releases without touching project source', async () => {
    const { fs, files } = memoryFileSystem({
      '.weeble/sdk.json': JSON.stringify({ version: '0.1.2', hash: 'old' }),
      'src/main.ts': 'keep me',
    });
    const installed = await readInstalledSdk(fs);
    expect(installed).toEqual({ version: '0.1.2', hash: 'old' });
    expect(hasSdkUpdate(installed, { version: '0.2.0', hash: 'new' })).toBe(true);

    await installSdkRelease(fs, {
      version: '0.2.0',
      hash: 'new',
      discord: 'discord types',
      runtime: 'runtime types',
    });

    expect(files['.weeble/types/lib.weeble.d.ts']).toBe('discord types');
    expect(files['.weeble/types/runtime.d.ts']).toBe('runtime types');
    expect(JSON.parse(files['.weeble/sdk.json'])).toEqual({
      version: '0.2.0',
      hash: 'new',
    });
    expect(files['src/main.ts']).toBe('keep me');
  });

  it('never replaces a newer installed SDK with an older remote release', () => {
    expect(
      hasSdkUpdate(
        { version: '0.3.0', hash: 'newer' },
        { version: '0.2.0', hash: 'older' },
      ),
    ).toBe(false);
  });

  it('flags an update that crosses a major version', () => {
    const installed = { version: '2.4.0', hash: 'a' };
    expect(isMajorSdkUpdate(installed, { version: '3.0.0' })).toBe(true);
    expect(isMajorSdkUpdate(installed, { version: '2.5.0' })).toBe(false);
    expect(isMajorSdkUpdate(undefined, { version: '3.0.0' })).toBe(false);
    expect(isMajorSdkUpdate({ version: 'dev', hash: 'a' }, { version: '3.0.0' })).toBe(false);
  });
});
