export interface WeebleApiClientOptions {
  baseUrl: string;
  accessToken?: string;
  fetcher?: typeof fetch;
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  scopes: string[];
}

export interface DeveloperToken {
  tokenId: string;
  accessToken: string;
  tokenType: string;
  clientName: string;
  scopes: string[];
  expiresAt: number;
}

export interface SessionIdentity {
  userId: string;
  username: string;
  avatar: string | null;
}

export interface ScriptProject {
  entrypoint: string;
  files: Record<string, string>;
}

export interface PackageLockEntry {
  version: string;
  entrypoint: string;
  types?: string | null;
  content_hash: string;
  dependencies: Record<string, string>;
}

export type PackageLock = Record<string, PackageLockEntry>;

export interface Deployment {
  id: string;
  owner_id: string;
  name: string;
  guild_id: string;
  bot_id: string;
  bot_identity_id?: string | null;
  type: number;
  status: number;
  current_revision: number;
  active_revision?: number | null;
  repository_url?: string;
  project_path?: string;
}

export interface DeploymentRevision {
  deployment_id: string;
  revision: number;
  project: ScriptProject;
  user_bundle: string;
  source_size: number;
  package_lock: PackageLock;
  publisher_id: string;
  publisher_name: string;
  created_at: number;
  release_note: string;
  source_hash: string;
  repository_url?: string;
  git_commit?: string;
  git_ref?: string;
  project_path?: string;
  workspace_dirty?: boolean;
  workspace_version?: string;
  artifact_hash?: string;
}

export type DeploymentRevisionSummary = Omit<DeploymentRevision, 'project' | 'user_bundle' | 'package_lock'>;

export interface DeploymentRevisionSource extends DeploymentRevisionSummary {
  project: ScriptProject;
  package_lock?: PackageLock;
}

export interface EditorDeployment {
  deployment_key: {
    deployment_id: string;
    revision: number;
    bot_id: string;
    guild_id: string;
  };
  project: ScriptProject;
  package_lock: PackageLock;
  enabled: boolean;
}

export interface ConsoleLogEntry {
  id?: number;
  level?: string;
  message?: string;
  timestamp: number;
  deployment_id?: string;
  revision?: number | null;
  event_name?: string | null;
  source?: string | null;
  latency_ms?: number | null;
  error_name?: string | null;
  error_message?: string | null;
  stack_trace?: string | null;
}

export interface KvItem {
  namespace: string;
  key: string;
  value: unknown;
  cas_version: number;
  ttl_ms: number | null;
}

export interface KvPutInput {
  namespace: string;
  key: string;
  value: unknown;
  ttlMs: number | null;
  expectedCasVersion?: number;
}

export interface PackageVersionSource {
  package_name: string;
  version: string;
  entrypoint: string;
  types?: string | null;
  files: Record<string, string>;
  declared_imports: Record<string, string>;
  content_hash: string;
  status?: 'approved' | 'revoked';
  source?: 'weeble' | 'npm';
  registry_integrity?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: number | null;
  review_reason?: string | null;
}

export interface PackageVersionSummary {
  package_name: string;
  version: string;
  description: string;
  entrypoint: string;
  types?: string | null;
  content_hash: string;
  declared_imports: Record<string, string>;
  status: 'approved' | 'revoked';
  source: 'weeble' | 'npm';
  registry_integrity?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: number | null;
  review_reason?: string | null;
  created_at: number;
}

export interface PackageCatalogItem {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  created_at: number;
  updated_at: number;
}

export interface PackageScanArtifact {
  name: string;
  version: string;
  content_hash: string;
  archive_sha256?: string;
  registry_integrity?: string | null;
  entrypoint?: string;
  types?: string | null;
  dependencies?: Record<string, string>;
  file_count?: number;
  install_scripts?: string[];
  provenance_url?: string | null;
  signature_count?: number;
}

export interface PackageScanReport {
  compatible: boolean;
  package_count: number;
  artifacts: PackageScanArtifact[];
  warnings?: string[];
  review_reasons?: string[];
  vulnerabilities?: Array<{
    package: string;
    version: string;
    id: string;
    summary?: string;
  }>;
  blockers?: string[];
}

export interface PackageRequest {
  id: string;
  name: string;
  version: string;
  requester_id: string;
  status: 'pending' | 'approved' | 'rejected';
  scan: PackageScanReport;
  created_at: number;
  reviewed_by?: string | null;
  reviewed_at?: number | null;
  review_reason?: string | null;
}

/** What the build service returns for a project: the bundle, ready to publish. */
export interface BuiltArtifact {
  code: string;
  sourceMap: string;
  warnings: string[];
  project: ScriptProject;
  packageLock: PackageLock;
  artifactHash: string;
}

export interface PublishBundleInput {
  project: ScriptProject;
  userBundle: string;
  sourceMap: string;
  expectedRevision: number | null;
  packageLock: PackageLock;
  releaseNote?: string;
  source?: {
    repositoryUrl?: string;
    gitCommit?: string;
    gitRef?: string;
    projectPath?: string;
    workspaceDirty?: boolean;
    workspaceVersion?: string;
    artifactHash?: string;
  };
}

export class WeebleApiError extends Error {
  readonly name = 'WeebleApiError';

  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
  }
}

export class WeebleApiClient {
  private readonly baseUrl: string;
  private readonly accessToken: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor(options: WeebleApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.accessToken = options.accessToken;
    this.fetcher = options.fetcher ?? fetch;
  }

  async createDeviceAuthorization(
    clientName: string,
    scopes: string[],
  ): Promise<DeviceAuthorization> {
    const body = await this.request<{
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
      scopes: string[];
    }>('/auth/device', {
      method: 'POST',
      body: JSON.stringify({ client_name: clientName, scopes }),
    });
    return {
      deviceCode: body.device_code,
      userCode: body.user_code,
      verificationUri: body.verification_uri,
      expiresIn: body.expires_in,
      interval: body.interval,
      scopes: body.scopes,
    };
  }

  async exchangeDeviceAuthorization(deviceCode: string): Promise<DeveloperToken> {
    const body = await this.request<{
      token_id: string;
      access_token: string;
      token_type: string;
      client_name: string;
      scopes: string[];
      expires_at: number;
    }>('/auth/device/token', {
      method: 'POST',
      body: JSON.stringify({ device_code: deviceCode }),
    });
    return {
      tokenId: body.token_id,
      accessToken: body.access_token,
      tokenType: body.token_type,
      clientName: body.client_name,
      scopes: body.scopes,
      expiresAt: body.expires_at,
    };
  }

  async session(): Promise<SessionIdentity> {
    const { user } = await this.request<{
      user: { user_id: string; username: string; avatar: string | null };
    }>('/auth/session');
    return { userId: user.user_id, username: user.username, avatar: user.avatar };
  }

  async listDeployments(): Promise<Deployment[]> {
    return (await this.request<{ deployments: Deployment[] }>('/deployments')).deployments;
  }

  async getDeployment(deploymentId: string): Promise<Deployment> {
    return (
      await this.request<{ deployment: Deployment }>(
        `/deployments/${encodeURIComponent(deploymentId)}`,
      )
    ).deployment;
  }

  async getEditorDeployment(deploymentId: string): Promise<EditorDeployment> {
    return this.request<EditorDeployment>(
      `/deployments/${encodeURIComponent(deploymentId)}/editor`,
    );
  }

  async listRevisions(deploymentId: string): Promise<DeploymentRevisionSummary[]> {
    return (
      await this.request<{ revisions: DeploymentRevisionSummary[] }>(
        `/deployments/${encodeURIComponent(deploymentId)}/revisions`,
      )
    ).revisions;
  }

  async getRevisionSource(deploymentId: string, revision: number): Promise<DeploymentRevisionSource> {
    return (
      await this.request<{ revision: DeploymentRevisionSource }>(
        `/deployments/${encodeURIComponent(deploymentId)}/revisions/${revision}`,
      )
    ).revision;
  }

  async getLogs(
    deploymentId: string,
    options: { since?: number; limit?: number } = {},
  ): Promise<ConsoleLogEntry[]> {
    const query = new URLSearchParams();
    if (options.since !== undefined) query.set('since', String(options.since));
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    return (
      await this.request<{ logs: ConsoleLogEntry[] }>(
        `/deployments/${encodeURIComponent(deploymentId)}/logs${suffix}`,
      )
    ).logs;
  }

  async listKv(deploymentId: string): Promise<KvItem[]> {
    return (
      await this.request<{ items: KvItem[] }>(
        `/deployments/${encodeURIComponent(deploymentId)}/kv`,
      )
    ).items;
  }

  async putKv(deploymentId: string, input: KvPutInput): Promise<KvItem> {
    return (
      await this.request<{ item: KvItem }>(
        `/deployments/${encodeURIComponent(deploymentId)}/kv`,
        {
          method: 'POST',
          body: JSON.stringify({
            namespace: input.namespace,
            key: input.key,
            value: input.value,
            ttl_ms: input.ttlMs,
            expected_cas_version: input.expectedCasVersion,
          }),
        },
      )
    ).item;
  }

  async deleteKv(deploymentId: string, namespace: string, key: string): Promise<boolean> {
    return (
      await this.request<{ deleted: boolean }>(
        `/deployments/${encodeURIComponent(deploymentId)}/kv/${encodeURIComponent(namespace)}/${encodePath(key)}`,
        { method: 'DELETE' },
      )
    ).deleted;
  }

  async deleteKvNamespace(deploymentId: string, namespace: string): Promise<number> {
    return (
      await this.request<{ deleted: number }>(
        `/deployments/${encodeURIComponent(deploymentId)}/kv/${encodeURIComponent(namespace)}`,
        { method: 'DELETE' },
      )
    ).deleted;
  }

  async resolvePackages(
    dependencies: Record<string, string>,
  ): Promise<{
    resolved: Record<string, string>;
    versions: Record<
      string,
      {
        name: string;
        version: string;
        entrypoint: string;
        types?: string | null;
        content_hash: string;
        dependencies: Record<string, string>;
      }
    >;
  }> {
    return this.request('/packages/resolve', {
      method: 'POST',
      body: JSON.stringify({ dependencies }),
    });
  }

  async getPackageVersion(name: string, version: string): Promise<PackageVersionSource> {
    return (
      await this.request<{ version: PackageVersionSource }>(
        `/packages/${encodePath(name)}/${encodeURIComponent(version)}`,
      )
    ).version;
  }

  async searchPackages(query = '', limit = 50): Promise<PackageCatalogItem[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (query.trim()) params.set('q', query.trim());
    return (
      await this.request<{ packages: PackageCatalogItem[] }>(
        `/packages?${params.toString()}`,
      )
    ).packages;
  }

  async listPackageVersions(name: string): Promise<PackageVersionSummary[]> {
    return (
      await this.request<{ versions: PackageVersionSummary[] }>(
        `/packages/${encodePath(name)}/versions`,
      )
    ).versions;
  }

  async requestPackage(name: string, version: string): Promise<PackageRequest> {
    return (
      await this.request<{ request: PackageRequest }>('/packages/requests', {
        method: 'POST',
        body: JSON.stringify({ name, version }),
      })
    ).request;
  }

  async listMyPackageRequests(): Promise<PackageRequest[]> {
    return (
      await this.request<{ requests: PackageRequest[] }>('/packages/requests/mine')
    ).requests;
  }

  async publishBundle(
    deploymentId: string,
    input: PublishBundleInput,
  ): Promise<{
    created: boolean;
    revision: DeploymentRevision;
    deployment: Deployment;
    runtime: unknown;
    gateway: unknown;
    commands: unknown;
  }> {
    return this.request(`/deployments/${encodeURIComponent(deploymentId)}/publish-bundle`, {
      method: 'POST',
      body: JSON.stringify({
        project: input.project,
        user_bundle: input.userBundle,
        source_map: input.sourceMap,
        expected_revision: input.expectedRevision,
        package_lock: input.packageLock,
        release_note: input.releaseNote ?? '',
        repository_url: input.source?.repositoryUrl,
        git_commit: input.source?.gitCommit,
        git_ref: input.source?.gitRef,
        project_path: input.source?.projectPath,
        workspace_dirty: input.source?.workspaceDirty,
        workspace_version: input.source?.workspaceVersion,
        artifact_hash: input.source?.artifactHash,
      }),
    });
  }

  async activateDeployment(
    deploymentId: string,
    revision?: number,
  ): Promise<Deployment> {
    return (
      await this.request<{ deployment: Deployment }>(
        `/deployments/${encodeURIComponent(deploymentId)}/activate`,
        {
          method: 'POST',
          body: JSON.stringify(revision === undefined ? {} : { revision }),
        },
      )
    ).deployment;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    if (this.accessToken !== undefined) {
      headers.set('authorization', `Bearer ${this.accessToken}`);
    }
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: Object.fromEntries(headers.entries()),
    });
    const body = await readJson(response);
    if (!response.ok) {
      const detail =
        typeof body === 'object' &&
        body !== null &&
        'detail' in body &&
        typeof body.detail === 'string'
          ? body.detail
          : `Weeble API request failed with status ${response.status}`;
      throw new WeebleApiError(response.status, detail);
    }
    return body as T;
  }
}

function encodePath(value: string): string {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new WeebleApiError(response.status, 'Weeble API returned invalid JSON');
  }
}
