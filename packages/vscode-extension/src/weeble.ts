import * as vscode from 'vscode';
import {
  WeebleApiClient,
  WeebleApiError,
  type Deployment,
  type ScriptProject,
  type SessionIdentity,
} from '@weeble/api-client';
import { IGNORED_DIRECTORIES, loadProjectFiles, type ProjectDirectoryReader } from '@weeble/project';
import { readProject, type Project } from './lib/project';
import type { WritableWorkspaceFileSystem } from './lib/workspaceInitializer';

const TOKEN_KEY = 'weeble.developerToken';
const DEPLOYMENT_RUNNING = 1;

/**
 * State shared by every feature: the signed-in session, the deployment this
 * folder is connected to, and the Weeble output channel.
 *
 * API responses that the sidebar and status bar both show (the session and
 * the deployment) are fetched once and kept until something changes them.
 */
export class Weeble implements vscode.Disposable {
  readonly log = vscode.window.createOutputChannel('Weeble', { log: true });
  /** The first workspace folder, which holds the connected deployment. */
  readonly root: vscode.Uri | undefined = vscode.workspace.workspaceFolders?.[0]?.uri;
  project: Project | undefined;

  private client: WeebleApiClient | undefined;
  private session: Promise<SessionIdentity> | undefined;
  private cachedDeployment: Promise<Deployment> | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires after sign-in, sign-out, a project change or `invalidate()`. */
  readonly onDidChange = this.changed.event;

  private constructor(private readonly context: vscode.ExtensionContext) {}

  static async create(context: vscode.ExtensionContext): Promise<Weeble> {
    const weeble = new Weeble(context);
    weeble.useToken(await context.secrets.get(TOKEN_KEY));
    await weeble.reloadProject().catch((error) => weeble.log.error(errorMessage(error)));
    return weeble;
  }

  get signedIn(): boolean {
    return this.client !== undefined;
  }

  /** An API client without a token, for signing in. */
  anonymousApi(): WeebleApiClient {
    return new WeebleApiClient({ baseUrl: this.apiUrl });
  }

  api(): WeebleApiClient {
    if (!this.client) throw new Error('Sign in to Weeble first.');
    return this.client;
  }

  get apiUrl(): string {
    return setting('apiUrl', 'https://api.weeble.works');
  }

  get buildServiceUrl(): string {
    return setting('buildServiceUrl', 'https://build.weeble.works');
  }

  /** This extension's version, recorded with each revision it publishes. */
  get extensionVersion(): string {
    return (this.context.extension.packageJSON as { version: string }).version;
  }

  async token(): Promise<string> {
    const token = await this.context.secrets.get(TOKEN_KEY);
    if (!token) throw new Error('Sign in to Weeble first.');
    return token;
  }

  async signIn(token: string): Promise<void> {
    await this.context.secrets.store(TOKEN_KEY, token);
    this.useToken(token);
    this.invalidate();
  }

  async signOut(): Promise<void> {
    await this.context.secrets.delete(TOKEN_KEY);
    this.useToken(undefined);
    this.invalidate();
  }

  identity(): Promise<SessionIdentity> {
    this.session ??= this.api()
      .session()
      .catch((error) => {
        this.session = undefined;
        throw error;
      });
    return this.session;
  }

  requireRoot(): vscode.Uri {
    if (!this.root) throw new Error('Open a folder to use Weeble.');
    return this.root;
  }

  requireProject(): Project {
    if (!this.project) throw new Error('Select a Weeble deployment first.');
    return this.project;
  }

  /** The connected deployment, fetched once until `invalidate()`. */
  deployment(): Promise<Deployment> {
    const project = this.requireProject();
    this.cachedDeployment ??= this.api().getDeployment(project.deployment).catch((error) => {
      this.cachedDeployment = undefined;
      throw error;
    });
    return this.cachedDeployment;
  }

  /** Re-reads `.weeble/project.json`. */
  async reloadProject(): Promise<void> {
    this.project = this.root ? await readProject(this.files) : undefined;
    this.invalidate();
  }

  /** Drops cached deployment state and tells views to redraw. */
  invalidate(): void {
    this.cachedDeployment = undefined;
    void vscode.commands.executeCommand('setContext', 'weeble.signedIn', this.signedIn);
    void vscode.commands.executeCommand('setContext', 'weeble.hasProject', this.project !== undefined);
    this.changed.fire();
  }

  uri(path: string): vscode.Uri {
    return vscode.Uri.joinPath(this.requireRoot(), ...path.split('/'));
  }

  /** The workspace folder, with paths relative to it. */
  readonly files: WritableWorkspaceFileSystem = {
    readText: async (path) => new TextDecoder().decode(await vscode.workspace.fs.readFile(this.uri(path))),
    exists: async (path) => {
      try {
        await vscode.workspace.fs.stat(this.uri(path));
        return true;
      } catch {
        return false;
      }
    },
    writeText: async (path, contents) => {
      const target = this.uri(path);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(contents));
    },
    delete: async (path) => {
      await vscode.workspace.fs.delete(this.uri(path), { recursive: false, useTrash: false });
    },
  };

  /** Reads deployment files from the workspace folder. */
  reader(): ProjectDirectoryReader {
    const root = this.requireRoot();
    return {
      listFiles: () => listFiles(root),
      readText: (path) => this.files.readText(path),
    };
  }

  /** The deployment's files as they are in the workspace now. */
  workspaceProject(): Promise<ScriptProject> {
    return loadProjectFiles(this.reader(), this.requireProject().entrypoint);
  }

  dispose(): void {
    this.log.dispose();
    this.changed.dispose();
  }

  private useToken(token: string | undefined): void {
    this.client = token ? new WeebleApiClient({ baseUrl: this.apiUrl, accessToken: token }) : undefined;
    this.session = undefined;
  }
}

/**
 * Registers a command whose errors are shown to the user instead of being
 * lost in the extension host log. An expired token also offers sign-in.
 */
export function command(
  id: string,
  run: (...args: any[]) => unknown,
): vscode.Disposable {
  return vscode.commands.registerCommand(id, async (...args: unknown[]) => {
    try {
      return await run(...args);
    } catch (error) {
      await showError(error);
    }
  });
}

export async function showError(error: unknown): Promise<void> {
  if (error instanceof WeebleApiError && error.status === 401) {
    const choice = await vscode.window.showErrorMessage('Your Weeble session has expired.', 'Sign In');
    if (choice) await vscode.commands.executeCommand('weeble.signIn');
    return;
  }
  void vscode.window.showErrorMessage(errorMessage(error));
}

/** The live revision, or `undefined` when the deployment isn't running. */
export function liveRevision(deployment: Deployment): number | undefined {
  return deployment.status === DEPLOYMENT_RUNNING ? (deployment.active_revision ?? undefined) : undefined;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listFiles(root: vscode.Uri, directory = ''): Promise<string[]> {
  const folder = directory ? vscode.Uri.joinPath(root, ...directory.split('/')) : root;
  const files: string[] = [];
  for (const [name, type] of await vscode.workspace.fs.readDirectory(folder)) {
    if (IGNORED_DIRECTORIES.has(name)) continue;
    const path = directory ? `${directory}/${name}` : name;
    if (type === vscode.FileType.Directory) files.push(...(await listFiles(root, path)));
    else if (type === vscode.FileType.File) files.push(path);
  }
  return files;
}

function setting(name: string, fallback: string): string {
  return vscode.workspace.getConfiguration('weeble').get<string>(name, fallback);
}
