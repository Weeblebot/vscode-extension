import * as vscode from 'vscode';
import { loadProjectDependencies } from '@weeble/project';
import { requestBuild } from '../lib/buildClient';
import { parseBuildDiagnostics } from '../lib/buildDiagnostics';
import { publishProject, type PublishOutcome } from '../lib/deploymentActions';
import { formatDeployProgress, formatDuration, type DeployProgress } from '../lib/deploymentOutput';
import { compareRevisionProjects } from '../lib/revisionDiff';
import { command, errorMessage, type Weeble } from '../weeble';

export interface DeployEvents {
  /** Called with a short status while deploying, and `undefined` when done. */
  onBusy(status: string | undefined): void;
}

export function registerDeploy(weeble: Weeble, events: DeployEvents): vscode.Disposable[] {
  const diagnostics = vscode.languages.createDiagnosticCollection('weeble');
  let deploying = false;
  return [
    diagnostics,
    command('weeble.deploy', async () => {
      if (deploying) {
        weeble.log.show(true);
        return;
      }
      deploying = true;
      try {
        await deploy(weeble, diagnostics, events);
      } finally {
        deploying = false;
        events.onBusy(undefined);
      }
    }),
  ];
}

async function deploy(
  weeble: Weeble,
  diagnostics: vscode.DiagnosticCollection,
  events: DeployEvents,
): Promise<void> {
  const project = weeble.requireProject();
  const api = weeble.api();
  const releaseNote = await vscode.window.showInputBox({
    title: `Deploy ${project.name}`,
    prompt: 'Release note (optional)',
    placeHolder: 'What changed?',
  });
  if (releaseNote === undefined) return;

  await vscode.workspace.saveAll(false);
  diagnostics.clear();
  const startedAt = Date.now();
  weeble.log.info(`Deploying ${project.name}`);
  events.onBusy('Building');

  const controller = new AbortController();
  let publishing = false;
  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Deploying ${project.name}`, cancellable: true },
      async (progress, cancel) => {
        cancel.onCancellationRequested(() => {
          // Once publishing starts the revision exists, so stopping would
          // only leave it half activated.
          if (!publishing) controller.abort(new Error('Deployment cancelled'));
        });
        const report = (event: DeployProgress) => {
          if (event.stage === 'publishing') publishing = true;
          const message = formatDeployProgress(event);
          weeble.log.info(message);
          progress.report({ message });
          events.onBusy(stageLabel(event));
        };

        const [files, dependencies, token] = await Promise.all([
          weeble.workspaceProject(),
          loadProjectDependencies(weeble.reader(), project.dependencies),
          weeble.token(),
        ]);
        const deployment = await weeble.deployment();
        if (deployment.current_revision > 0) {
          const current = await api.getEditorDeployment(project.deployment);
          const changes = compareRevisionProjects(current.project, files);
          report({
            stage: 'changes',
            added: changes.filter((change) => change.status === 'added').length,
            modified: changes.filter((change) => change.status === 'modified').length,
            deleted: changes.filter((change) => change.status === 'deleted').length,
          });
        }
        return publishProject(project.deployment, project.name, files, dependencies, {
          build: (source, deps, signal) =>
            requestBuild(fetch, weeble.buildServiceUrl, token, { project: source, dependencies: deps }, signal),
          api,
          releaseNote,
          workspaceVersion: `vscode-extension@${weeble.extensionVersion}`,
          onProgress: report,
          signal: controller.signal,
        });
      },
    );
    for (const warning of result.warnings) weeble.log.warn(warning);
    setDiagnostics(weeble, diagnostics, result.warnings, vscode.DiagnosticSeverity.Warning);
    weeble.log.info(`Done in ${formatDuration(Date.now() - startedAt)}`);
    weeble.invalidate();
    void vscode.window.showInformationMessage(outcomeMessage(result.outcome, result.revision));
  } catch (error) {
    if (controller.signal.aborted) {
      weeble.log.info('Deployment cancelled');
      return;
    }
    const message = errorMessage(error);
    weeble.log.error(`Deployment failed: ${message}`);
    setDiagnostics(weeble, diagnostics, [message], vscode.DiagnosticSeverity.Error);
    // Not awaited: the notification stays open until dismissed, and the
    // status bar should stop showing progress now.
    void vscode.window
      .showErrorMessage(`Deployment failed: ${firstLine(message)}`, 'Show Output')
      .then((choice) => choice && weeble.log.show(true));
  }
}

function stageLabel(event: DeployProgress): string {
  switch (event.stage) {
    case 'building':
    case 'changes':
      return 'Building';
    case 'built':
    case 'publishing':
      return 'Publishing';
    case 'published':
    case 'activating':
      return `Activating r${event.revision}`;
  }
}

function outcomeMessage(outcome: PublishOutcome, revision: number): string {
  switch (outcome) {
    case 'deployed':
      return `Deployed revision ${revision}.`;
    case 'activated-existing':
      return `Your code matches revision ${revision}, so that revision is live again.`;
    case 'unchanged':
      return 'No changes to deploy.';
  }
}

function setDiagnostics(
  weeble: Weeble,
  collection: vscode.DiagnosticCollection,
  messages: string[],
  severity: vscode.DiagnosticSeverity,
): void {
  const byFile = new Map<string, [vscode.Uri, vscode.Diagnostic[]]>();
  for (const message of messages) {
    for (const parsed of parseBuildDiagnostics(message)) {
      const path = parsed.path.replace(/^weeble:/, '').replace(/^\.\//, '');
      const uri = /^[A-Za-z]:\//.test(path) ? vscode.Uri.file(path) : weeble.uri(path.replace(/^\/+/, ''));
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(parsed.line, parsed.column, parsed.line, parsed.column + 1),
        parsed.message,
        severity,
      );
      diagnostic.source = 'Weeble build';
      const entry = byFile.get(uri.toString()) ?? [uri, []];
      entry[1].push(diagnostic);
      byFile.set(uri.toString(), entry);
    }
  }
  for (const [uri, list] of byFile.values()) collection.set(uri, list);
}

function firstLine(message: string): string {
  return message.split('\n', 1)[0];
}
