import * as vscode from 'vscode';
import { IGNORED_DIRECTORIES } from '@weeble/project';
import { entrypointCandidates, updateProjectEntrypoint } from '../lib/entrypointSelection';
import { PROJECT_FILE } from '../lib/project';
import type { SdkRelease } from '../lib/sdkUpdate';
import { installDeploymentWorkspace } from '../lib/workspaceInitializer';
import { command, errorMessage, liveRevision, type Weeble } from '../weeble';

const DASHBOARD_URL = 'https://weeble.works/guilds';

/** Connecting this folder to a deployment and choosing its entrypoint. */
export function registerWorkspace(weeble: Weeble, context: vscode.ExtensionContext): vscode.Disposable[] {
  const watcher = weeble.root
    ? vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(weeble.root, PROJECT_FILE))
    : undefined;
  const reload = () => void weeble.reloadProject().catch((error) => weeble.log.error(errorMessage(error)));
  watcher?.onDidCreate(reload);
  watcher?.onDidChange(reload);
  watcher?.onDidDelete(reload);

  return [
    ...(watcher ? [watcher] : []),
    command('weeble.selectDeployment', () => selectDeployment(weeble, context)),
    command('weeble.setEntrypoint', () => setEntrypoint(weeble)),
    command('weeble.copyDeploymentId', async () => {
      const { deployment } = weeble.requireProject();
      await vscode.env.clipboard.writeText(deployment);
      void vscode.window.showInformationMessage(`Copied deployment ID ${deployment}.`);
    }),
    command('weeble.openDashboard', () => vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL))),
    command('weeble.refresh', () => weeble.reloadProject()),
  ];
}

async function selectDeployment(weeble: Weeble, context: vscode.ExtensionContext): Promise<void> {
  weeble.requireRoot();
  const api = weeble.api();
  const deployments = await api.listDeployments();
  if (deployments.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      'Create a deployment in the Weeble dashboard first.',
      'Open Dashboard',
    );
    if (choice) await vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL));
    return;
  }
  const picked = await vscode.window.showQuickPick(
    deployments.map((deployment) => {
      const live = liveRevision(deployment);
      return { label: deployment.name, description: live !== undefined ? `r${live} live` : 'Not running', deployment };
    }),
    { title: 'Select Deployment', placeHolder: 'Choose the deployment for this folder' },
  );
  if (!picked) return;
  const { deployment } = picked;
  const current = weeble.project;
  if (current && current.deployment !== deployment.id) {
    const choice = await vscode.window.showWarningMessage(
      `Replace ${current.name} with ${deployment.name}?`,
      { modal: true, detail: `Files downloaded for ${current.name} are removed.` },
      'Replace',
    );
    if (!choice) return;
  }
  const source =
    deployment.current_revision > 0
      ? await api.getEditorDeployment(deployment.id)
      : { project: { entrypoint: 'src/main.ts', files: {} }, package_lock: {} };
  const { entrypointPath } = await installDeploymentWorkspace(weeble.files, {
    name: deployment.name,
    deploymentId: deployment.id,
    guildId: deployment.guild_id,
    project: source.project,
    packageLock: source.package_lock,
    sdkTypes: await bundledSdkTypes(context),
  });
  await weeble.reloadProject();
  await vscode.window.showTextDocument(weeble.uri(entrypointPath));
}

async function setEntrypoint(weeble: Weeble): Promise<void> {
  const project = weeble.requireProject();
  const found = await vscode.workspace.findFiles('**/*', `{${[...IGNORED_DIRECTORIES].join(',')}}/**`);
  const candidates = entrypointCandidates(found.map((uri) => vscode.workspace.asRelativePath(uri, false)));
  if (!candidates.includes(project.entrypoint)) candidates.unshift(project.entrypoint);
  const picked = await vscode.window.showQuickPick(
    candidates.map((path) => ({
      label: path,
      description: path === project.entrypoint ? 'Current' : undefined,
    })),
    { title: 'Set Entrypoint', placeHolder: `The file ${project.name} runs` },
  );
  if (!picked || picked.label === project.entrypoint) return;
  const source = await weeble.files.readText(PROJECT_FILE);
  await weeble.files.writeText(PROJECT_FILE, updateProjectEntrypoint(source, picked.label));
  await weeble.reloadProject();
  void vscode.window.showInformationMessage(`Entrypoint set to ${picked.label}. It applies from the next deploy.`);
}

/** The SDK declarations bundled with this version of the extension. */
export async function bundledSdkTypes(
  context: vscode.ExtensionContext,
): Promise<SdkRelease> {
  const read = async (name: string) =>
    new TextDecoder().decode(
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'dist', 'types', name)),
    );
  const manifest = JSON.parse(await read('manifest.json')) as { version: string; hash: string };
  return {
    version: manifest.version,
    hash: manifest.hash,
    discord: await read('lib.weeble.d.ts'),
    runtime: await read('runtime.d.ts'),
  };
}
