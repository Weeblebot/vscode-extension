import * as vscode from 'vscode';
import { readInstalledSdk } from '../lib/sdkUpdate';
import { command, errorMessage, liveRevision, type Weeble } from '../weeble';

interface MenuItem extends vscode.QuickPickItem {
  command?: string;
}

/**
 * The status bar entry: the deployment and its active revision, or the next
 * step when there is none. Clicking it opens the Weeble menu.
 */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('weeble.status', vscode.StatusBarAlignment.Left, 100);
  private busy: string | undefined;
  /** Drops results from an earlier update that finished late. */
  private generation = 0;
  private readonly disposables: vscode.Disposable[];

  constructor(private readonly weeble: Weeble) {
    this.item.name = 'Weeble';
    this.disposables = [
      this.item,
      weeble.onDidChange(() => void this.update()),
      command('weeble.menu', () => this.showMenu()),
    ];
    void this.update();
  }

  setBusy(status: string | undefined): void {
    this.busy = status;
    void this.update();
  }

  private async update(): Promise<void> {
    const generation = ++this.generation;
    const { item, weeble } = this;
    if (!weeble.root) {
      item.hide();
      return;
    }
    item.show();
    if (!weeble.signedIn) {
      this.set('$(account) Sign in to Weeble', 'weeble.signIn');
      return;
    }
    const project = weeble.project;
    if (!project) {
      this.set('$(plug) Select Weeble deployment', 'weeble.selectDeployment');
      return;
    }
    if (this.busy) {
      this.set(`$(sync~spin) ${project.name} · ${this.busy}`, 'weeble.menu', 'Deploying');
      return;
    }
    this.set(`$(rocket) ${project.name}`, 'weeble.menu', project.name);
    try {
      const [deployment, sdk] = await Promise.all([weeble.deployment(), readInstalledSdk(weeble.files)]);
      if (generation !== this.generation) return;
      const live = liveRevision(deployment);
      const tooltip = new vscode.MarkdownString(
        [
          `**${project.name}**`,
          live !== undefined ? `Revision ${live} is live.` : 'Not running.',
          `Entrypoint: \`${project.entrypoint}\``,
          sdk ? `SDK types: ${sdk.version}` : undefined,
        ]
          .filter(Boolean)
          .join('\n\n'),
      );
      this.set(
        live !== undefined ? `$(rocket) ${project.name} · r${live}` : `$(circle-slash) ${project.name} · stopped`,
        'weeble.menu',
        tooltip,
      );
    } catch (error) {
      if (generation !== this.generation) return;
      this.set(`$(warning) ${project.name}`, 'weeble.menu', errorMessage(error));
    }
  }

  private set(text: string, commandId: string, tooltip?: string | vscode.MarkdownString): void {
    this.item.text = text;
    this.item.command = commandId;
    this.item.tooltip = tooltip ?? text.replace(/\$\([^)]*\)\s*/g, '');
  }

  private async showMenu(): Promise<void> {
    const project = this.weeble.project;
    const items: MenuItem[] = project
      ? [
          { label: '$(rocket) Deploy', command: 'weeble.deploy' },
          { label: '$(output) Runtime Logs', command: 'weeble.logs' },
          { label: '', kind: vscode.QuickPickItemKind.Separator },
          { label: '$(arrow-swap) Select Deployment', command: 'weeble.selectDeployment' },
          { label: '$(file-code) Set Entrypoint', description: project.entrypoint, command: 'weeble.setEntrypoint' },
          { label: '$(copy) Copy Deployment ID', command: 'weeble.copyDeploymentId' },
          { label: '$(cloud-download) Check for SDK Updates', command: 'weeble.checkSdkUpdates' },
          { label: '$(link-external) Open Dashboard', command: 'weeble.openDashboard' },
          { label: '', kind: vscode.QuickPickItemKind.Separator },
          { label: '$(sign-out) Sign Out', command: 'weeble.signOut' },
        ]
      : [
          { label: '$(plug) Select Deployment', command: 'weeble.selectDeployment' },
          { label: '$(link-external) Open Dashboard', command: 'weeble.openDashboard' },
          { label: '$(sign-out) Sign Out', command: 'weeble.signOut' },
        ];
    const picked = await vscode.window.showQuickPick(items, { title: project?.name ?? 'Weeble' });
    if (picked?.command) await vscode.commands.executeCommand(picked.command);
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}
