export interface SdkManifest {
  version: string;
  hash: string;
  discord: string;
  runtime: string;
  githubReleaseUrl?: string;
  releaseNotes?: string;
}

export interface InstalledSdk {
  version: string;
  hash: string;
}

export interface SdkRelease extends InstalledSdk {
  discord: string;
  runtime: string;
}

export interface SdkUpdateFileSystem {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
}

export function sdkManifestUrl(apiUrl: string): string {
  return new URL('/sdk/manifest.json', apiUrl).toString();
}

export function sdkReleaseManifestUrl(apiUrl: string, version: string): string {
  return new URL(`/sdk/releases/${encodeURIComponent(version)}/manifest.json`, apiUrl).toString();
}

export async function fetchSdkManifest(
  fetcher: typeof fetch,
  manifestUrl: string,
): Promise<SdkManifest> {
  const response = await fetcher(manifestUrl);
  if (!response.ok) {
    throw new Error(`SDK update check failed with HTTP ${response.status}`);
  }
  return parseManifest(await response.json());
}

export async function downloadSdkRelease(
  fetcher: typeof fetch,
  manifestUrl: string,
  providedManifest?: SdkManifest,
): Promise<SdkRelease> {
  const manifest = providedManifest ?? (await fetchSdkManifest(fetcher, manifestUrl));
  const source = new URL(manifestUrl);
  const discordUrl = resolveAssetUrl(source, manifest.discord);
  const runtimeUrl = resolveAssetUrl(source, manifest.runtime);
  const [discord, runtime] = await Promise.all([
    fetchText(fetcher, discordUrl),
    fetchText(fetcher, runtimeUrl),
  ]);
  const actualHash = await hashSdkTypes(discord, runtime);
  if (actualHash !== manifest.hash) {
    throw new Error('Downloaded SDK declarations failed the integrity check');
  }
  return {
    version: manifest.version,
    hash: manifest.hash,
    discord,
    runtime,
  };
}

/**
 * Whether going from the installed SDK to `available` crosses a major
 * version. Major releases can break existing scripts. With nothing installed
 * there is nothing to break.
 */
export function isMajorSdkUpdate(installed: InstalledSdk | undefined, available: Pick<SdkManifest, 'version'>): boolean {
  if (!installed) return false;
  const from = parseVersion(installed.version);
  const to = parseVersion(available.version);
  return from !== undefined && to !== undefined && to[0]! > from[0]!;
}

export function hasSdkUpdate(
  installed: InstalledSdk | undefined,
  available: Pick<SdkManifest, 'version' | 'hash'>,
): boolean {
  if (!installed) return true;
  const installedVersion = parseVersion(installed.version);
  const availableVersion = parseVersion(available.version);
  if (!installedVersion || !availableVersion) return installed.hash !== available.hash;
  for (let index = 0; index < availableVersion.length; index += 1) {
    const difference = availableVersion[index]! - installedVersion[index]!;
    if (difference > 0) return true;
    if (difference < 0) return false;
  }
  return installed.hash !== available.hash;
}

export async function readInstalledSdk(
  fs: SdkUpdateFileSystem,
): Promise<InstalledSdk | undefined> {
  if (!(await fs.exists('.weeble/sdk.json'))) return undefined;
  try {
    const value = JSON.parse(await fs.readText('.weeble/sdk.json')) as unknown;
    if (!isRecord(value)) return undefined;
    const version = value.version;
    const hash = value.hash;
    return typeof version === 'string' && typeof hash === 'string'
      ? { version, hash }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function installSdkRelease(
  fs: SdkUpdateFileSystem,
  release: SdkRelease,
): Promise<void> {
  await fs.writeText('.weeble/types/lib.weeble.d.ts', release.discord);
  await fs.writeText('.weeble/types/runtime.d.ts', release.runtime);
  await fs.writeText(
    '.weeble/sdk.json',
    `${JSON.stringify({ version: release.version, hash: release.hash }, null, 2)}\n`,
  );
}

function parseManifest(value: unknown): SdkManifest {
  if (!isRecord(value)) throw new Error('SDK manifest is invalid');
  const fields = ['version', 'hash', 'discord', 'runtime'] as const;
  for (const field of fields) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new Error(`SDK manifest field "${field}" is invalid`);
    }
  }
  if (!parseVersion(value.version as string)) {
    throw new Error('SDK manifest field "version" is invalid');
  }
  return {
    version: value.version as string,
    hash: value.hash as string,
    discord: value.discord as string,
    runtime: value.runtime as string,
    githubReleaseUrl: optionalString(value.githubReleaseUrl),
    releaseNotes: optionalString(value.releaseNotes),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function resolveAssetUrl(manifestUrl: URL, path: string): URL {
  const url = new URL(path, manifestUrl);
  if (url.origin !== manifestUrl.origin) {
    throw new Error('SDK declaration files must use the same origin as the manifest');
  }
  return url;
}

async function fetchText(fetcher: typeof fetch, url: URL): Promise<string> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`SDK declaration download failed with HTTP ${response.status}`);
  }
  return response.text();
}

async function hashSdkTypes(discord: string, runtime: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${discord}\0${runtime}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseVersion(value: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
