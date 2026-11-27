import * as vscode from 'vscode';
import { registerAuth } from './features/auth';
import { registerDeploy } from './features/deploy';
import { kvSection } from './features/kv';
import { registerLogs } from './features/logs';
import { packagesSection } from './features/packages';
import { revisionsSection } from './features/revisions';
import { registerSdk } from './features/sdk';
import { StatusBar } from './features/status';
import { registerWorkspace } from './features/workspace';
import { Sidebar, type Section } from './sidebar';
import { Weeble } from './weeble';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const weeble = await Weeble.create(context);
  const status = new StatusBar(weeble);

  // Sections refresh themselves through the sidebar once it exists.
  let sidebar: Sidebar | undefined;
  const refresh = (section: Section) => sidebar?.refresh(section);
  const [revisions, revisionCommands] = revisionsSection(weeble, context);
  const [kv, kvCommands] = kvSection(weeble, refresh);
  const [packages, packageCommands] = packagesSection(weeble, refresh);
  sidebar = new Sidebar(weeble, [revisions, kv, packages]);

  context.subscriptions.push(
    weeble,
    status,
    vscode.window.registerTreeDataProvider('weeble.sidebar', sidebar),
    ...registerAuth(weeble),
    ...registerWorkspace(weeble, context),
    ...registerDeploy(weeble, { onBusy: (text) => status.setBusy(text) }),
    ...registerLogs(weeble),
    ...registerSdk(weeble, context),
    ...revisionCommands,
    ...kvCommands,
    ...packageCommands,
  );
}

export function deactivate(): void {}
