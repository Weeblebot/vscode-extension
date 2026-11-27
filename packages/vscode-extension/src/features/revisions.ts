import * as vscode from 'vscode';
import type { DeploymentRevisionSource, DeploymentRevisionSummary } from '@weeble/api-client';
import { compareRevisionProjects, type RevisionFileChange } from '../lib/revisionDiff';
import { installDeploymentWorkspace } from '../lib/workspaceInitializer';
import { relativeTime } from '../lib/time';
import type { Parent, Section } from '../sidebar';
import { command, type Weeble } from '../weeble';
import { bundledSdkTypes } from './workspace';

class RevisionItem extends vscode.TreeItem implements Parent {
  constructor(
    readonly revision: DeploymentRevisionSummary,
    private readonly previous: DeploymentRevisionSummary | undefined,
    active: boolean,
    private readonly source: RevisionSources,
  ) {
    super(`r${revision.revision}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `revision:${revision.deployment_id}:${revision.revision}`;
    this.description = revisionDescription(revision, active);
    this.tooltip = new vscode.MarkdownString(
      [
        `**Revision ${revision.revision}**${active ? ' (active)' : ''}`,
        `${revision.publisher_name || revision.publisher_id}, ${new Date(revision.created_at * 1000).toLocaleString()}`,
        revision.release_note,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
    this.iconPath = active
      ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
      : new vscode.ThemeIcon('git-commit');
    this.contextValue = active ? 'weeble.revision.active' : 'weeble.revision';
  }

  /** The files this revision changed from the one before it. */
  async children(): Promise<vscode.TreeItem[]> {
    const [after, before] = await Promise.all([
      this.source.get(this.revision.revision),
      this.previous ? this.source.get(this.previous.revision) : undefined,
    ]);
    return compareRevisionProjects(before?.project, after.project).map(
      (change) => new RevisionFileItem(change, this.previous?.revision ?? 0, this.revision.revision),
    );
  }
}

class RevisionFileItem extends vscode.TreeItem {
  constructor(
    readonly change: RevisionFileChange,
    readonly from: number,
    readonly to: number,
  ) {
    super(vscode.Uri.from({ scheme: 'weeble-revision', path: `/${change.path}` }));
    this.label = change.path;
    this.description = { added: 'A', deleted: 'D', modified: 'M' }[change.status];
    this.command = { command: 'weeble.openRevisionDiff', title: 'Open Changes', arguments: [this] };
  }
}

/** Revision sources never change, so each is fetched once. */
class RevisionSources {
  private readonly sources = new Map<string, Promise<DeploymentRevisionSource>>();

  constructor(private readonly weeble: Weeble) {}

  get(revision: number): Promise<DeploymentRevisionSource> {
    const { deployment } = this.weeble.requireProject();
    const key = `${deployment}:${revision}`;
    let source = this.sources.get(key);
    if (!source) {
      source = this.weeble.api().getRevisionSource(deployment, revision);
      source.catch(() => this.sources.delete(key));
      this.sources.set(key, source);
    }
    return source;
  }
}

/** Serves both sides of a revision diff. */
class RevisionDocuments implements vscode.TextDocumentContentProvider {
  private readonly documents = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) ?? '';
  }

  uri(label: string, path: string, contents: string): vscode.Uri {
    const uri = vscode.Uri.from({ scheme: 'weeble-revision', authority: label, path: `/${path}` });
    this.documents.set(uri.toString(), contents);
    return uri;
  }
}

/** "Active · 3h ago · release note" */
function revisionDescription(revision: DeploymentRevisionSummary, active: boolean): string {
  return [active ? 'Active' : undefined, relativeTime(revision.created_at), revision.release_note || undefined]
    .filter(Boolean)
    .join(' · ');
}

export function revisionsSection(weeble: Weeble, context: vscode.ExtensionContext): [Section, vscode.Disposable[]] {
  const sources = new RevisionSources(weeble);
  const documents = new RevisionDocuments();

  /** Every revision, newest first, and which one is live. */
  const listRevisions = async () => {
    const [revisions, deployment] = await Promise.all([
      weeble.api().listRevisions(weeble.requireProject().deployment),
      weeble.deployment(),
    ]);
    return { revisions: [...revisions].sort((a, b) => b.revision - a.revision), active: deployment.active_revision };
  };

  const section: Section = {
    label: 'Revisions',
    contextValue: 'weeble.revisions',
    async children() {
      const { revisions, active } = await listRevisions();
      return revisions.map(
        (revision, index) => new RevisionItem(revision, revisions[index + 1], revision.revision === active, sources),
      );
    },
  };

  /** The revision a command applies to: the clicked item, or one the user picks. */
  const target = async (item: unknown): Promise<DeploymentRevisionSummary | undefined> => {
    if (item instanceof RevisionItem) return item.revision;
    const { revisions, active } = await listRevisions();
    const picked = await vscode.window.showQuickPick(
      revisions.map((revision) => ({
        label: `r${revision.revision}`,
        description: revisionDescription(revision, revision.revision === active),
        revision,
      })),
      { title: 'Select Revision' },
    );
    return picked?.revision;
  };

  const diff = (left: vscode.Uri, right: vscode.Uri, title: string) =>
    vscode.commands.executeCommand('vscode.diff', left, right, title);

  return [
    section,
    [
      vscode.workspace.registerTextDocumentContentProvider('weeble-revision', documents),
      command('weeble.openRevisionDiff', (item: RevisionFileItem) => {
        const { change, from, to } = item;
        return diff(
          documents.uri(`r${from}`, change.path, change.before),
          documents.uri(`r${to}`, change.path, change.after),
          `${change.path} (r${from || 'empty'} ↔ r${to})`,
        );
      }),
      command('weeble.activateRevision', async (item?: unknown) => {
        const revision = await target(item);
        if (!revision) return;
        const choice = await vscode.window.showWarningMessage(
          `Make revision ${revision.revision} live?`,
          { modal: true, detail: 'Your local files do not change.' },
          'Activate',
        );
        if (!choice) return;
        const project = weeble.requireProject();
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Activating revision ${revision.revision}` },
          () => weeble.api().activateDeployment(project.deployment, revision.revision),
        );
        weeble.log.info(`Activated revision ${revision.revision}`);
        weeble.invalidate();
      }),
      command('weeble.compareRevision', async (item?: unknown) => {
        const revision = await target(item);
        if (!revision) return;
        const source = await sources.get(revision.revision);
        const workspace = await weeble.workspaceProject();
        const changes = compareRevisionProjects(source.project, workspace);
        if (changes.length === 0) {
          void vscode.window.showInformationMessage(`Your files match revision ${revision.revision}.`);
          return;
        }
        const picked = await vscode.window.showQuickPick(
          changes.map((change) => ({ label: change.path, description: change.status, change })),
          { title: `Changes since r${revision.revision}` },
        );
        if (!picked) return;
        const { change } = picked;
        await diff(
          documents.uri(`r${revision.revision}`, change.path, change.before),
          change.status === 'deleted' ? documents.uri('workspace', change.path, '') : weeble.uri(change.path),
          `${change.path} (r${revision.revision} ↔ workspace)`,
        );
      }),
      command('weeble.restoreRevision', async (item?: unknown) => {
        const revision = await target(item);
        if (!revision) return;
        const choice = await vscode.window.showWarningMessage(
          `Replace your files with revision ${revision.revision}?`,
          { modal: true, detail: 'This does not deploy. Unsaved and undeployed changes to deployment files are lost.' },
          'Restore',
        );
        if (!choice) return;
        const project = weeble.requireProject();
        const source = await sources.get(revision.revision);
        if (!source.package_lock) throw new Error('This revision has no package information to restore from.');
        const { entrypointPath } = await installDeploymentWorkspace(weeble.files, {
          name: project.name,
          deploymentId: project.deployment,
          guildId: project.guild,
          project: source.project,
          packageLock: source.package_lock,
          sdkTypes: await bundledSdkTypes(context),
        });
        await weeble.reloadProject();
        await vscode.window.showTextDocument(weeble.uri(entrypointPath));
        void vscode.window.showInformationMessage(`Restored revision ${revision.revision}. Deploy when ready.`);
      }),
      command('weeble.copyRevisionNumber', async (item: RevisionItem) => {
        await vscode.env.clipboard.writeText(String(item.revision.revision));
      }),
    ],
  ];
}
