import * as vscode from 'vscode';
import type { PackageCatalogItem, PackageRequest, PackageVersionSummary } from '@weeble/api-client';
import {
  formatPackageRequestReport,
  parseInstalledPackages,
  parsePackageInstallUri,
  visiblePackageRequests,
  type PackageSpec,
} from '../lib/packageCatalog';
import { message, type Parent, type Section } from '../sidebar';
import { command, showError, type Weeble } from '../weeble';
import { installApprovedPackage, synchronizeApprovedPackages, uninstallApprovedPackage } from './packageFiles';

class InstalledItem extends vscode.TreeItem {
  constructor(
    readonly installed: PackageSpec,
    packageJson: vscode.Uri,
  ) {
    super(installed.name);
    this.id = `package:${installed.name}`;
    this.description = installed.version;
    this.iconPath = new vscode.ThemeIcon('package');
    this.contextValue = 'weeble.package';
    this.command = { command: 'vscode.open', title: 'Open package.json', arguments: [packageJson] };
  }
}

class RequestsItem extends vscode.TreeItem implements Parent {
  constructor(private readonly load: () => Promise<PackageRequest[]>) {
    super('My Requests', vscode.TreeItemCollapsibleState.Collapsed);
    this.id = 'package-requests';
    this.iconPath = new vscode.ThemeIcon('history');
  }

  async children(): Promise<vscode.TreeItem[]> {
    const requests = await this.load();
    if (!requests.length) return [message('No requests')];
    return requests.map((request) => new RequestItem(request));
  }
}

class RequestItem extends vscode.TreeItem implements Parent {
  constructor(readonly request: PackageRequest) {
    super(`${request.name}@${request.version}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `package-request:${request.id}`;
    this.description = request.status;
    this.tooltip = `${request.name}@${request.version}, requested ${new Date(request.created_at * 1000).toLocaleString()}`;
    this.iconPath = new vscode.ThemeIcon(
      request.status === 'approved' ? 'pass-filled' : request.status === 'rejected' ? 'error' : 'clock',
    );
    this.contextValue = 'weeble.packageRequest';
    this.command = { command: 'weeble.openPackageRequest', title: 'Open Report', arguments: [this] };
  }

  /** What the scan found. */
  async children(): Promise<vscode.TreeItem[]> {
    const { scan } = this.request;
    const row = (label: string, description: string | undefined, icon: string, tooltip?: string) => {
      const item = message(label, icon);
      item.description = description;
      if (tooltip) item.tooltip = tooltip;
      return item;
    };
    return [
      row(
        scan.compatible ? 'Runtime compatible' : 'Runtime incompatible',
        `${scan.package_count} ${scan.package_count === 1 ? 'package' : 'packages'}`,
        scan.compatible ? 'pass-filled' : 'error',
      ),
      ...(scan.blockers ?? []).map((text) => row(text, 'blocker', 'error')),
      ...(scan.review_reasons ?? []).map((text) => row(text, 'needs review', 'warning')),
      ...(scan.vulnerabilities ?? []).map((item) =>
        row(item.id, `${item.package}@${item.version}`, 'warning', item.summary),
      ),
      ...(scan.warnings ?? []).map((text) => row(text, 'note', 'info')),
    ];
  }
}

/** Serves request reports as read-only Markdown documents. */
class Reports implements vscode.TextDocumentContentProvider {
  private readonly reports = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.reports.get(uri.toString()) ?? '';
  }

  async open(request: PackageRequest): Promise<void> {
    const uri = vscode.Uri.from({
      scheme: 'weeble-package-review',
      authority: request.id,
      path: `/${encodeURIComponent(request.name)}-${request.version}.md`,
    });
    this.reports.set(uri.toString(), formatPackageRequestReport(request));
    await vscode.commands.executeCommand('markdown.showPreview', uri);
  }
}

export function packagesSection(weeble: Weeble, refresh: (section: Section) => void): [Section, vscode.Disposable[]] {
  const reports = new Reports();
  const packageJson = () => weeble.uri('package.json');

  const section: Section = {
    label: 'Packages',
    contextValue: 'weeble.packages',
    async children() {
      const source = await weeble.files.readText('package.json').catch(() => '{}');
      const installed = parseInstalledPackages(source).map((entry) => new InstalledItem(entry, packageJson()));
      return [
        ...installed,
        // Pending requests and the most recent resolved ones; the rest are
        // under Open Package Request.
        new RequestsItem(async () => visiblePackageRequests(await weeble.api().listMyPackageRequests())),
      ];
    },
  };

  const add = async (name: string, version: string) => {
    const artifacts = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Adding ${name}@${version}` },
      () => installApprovedPackage(weeble.requireRoot(), weeble.api(), name, version),
    );
    refresh(section);
    void vscode.window.showInformationMessage(
      `Added ${name}@${version} (${artifacts} ${artifacts === 1 ? 'package' : 'packages'} downloaded for types).`,
    );
  };

  const watcher = weeble.root
    ? vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(weeble.root, 'package.json'))
    : undefined;
  watcher?.onDidChange(() => refresh(section));
  watcher?.onDidCreate(() => refresh(section));
  watcher?.onDidDelete(() => refresh(section));

  return [
    section,
    [
      ...(watcher ? [watcher] : []),
      vscode.workspace.registerTextDocumentContentProvider('weeble-package-review', reports),
      vscode.window.registerUriHandler({
        async handleUri(uri) {
          try {
            const request = parsePackageInstallUri(uri.path, uri.query);
            if (!request) throw new Error('This Weeble package link is invalid.');
            const target = weeble.requireProject().name;
            const choice = await vscode.window.showInformationMessage(
              `Add ${request.name}@${request.version} to ${target}?`,
              { modal: true },
              'Add Package',
            );
            if (choice) await add(request.name, request.version);
          } catch (error) {
            await showError(error);
          }
        },
      }),
      command('weeble.addPackage', async () => {
        const picked = await pickPackage(weeble);
        if (picked) await add(picked.name, picked.version.version);
      }),
      command('weeble.uninstallPackage', async (item: InstalledItem) => {
        const { name, version } = item.installed;
        const choice = await vscode.window.showWarningMessage(`Remove ${name}@${version}?`, { modal: true }, 'Remove');
        if (!choice) return;
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Removing ${name}` },
          () => uninstallApprovedPackage(weeble.requireRoot(), weeble.api(), name),
        );
        refresh(section);
      }),
      command('weeble.syncPackages', async () => {
        const count = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Syncing packages' },
          () => synchronizeApprovedPackages(weeble.requireRoot(), weeble.api()),
        );
        refresh(section);
        void vscode.window.showInformationMessage(`Synced ${count} ${count === 1 ? 'package' : 'packages'}.`);
      }),
      command('weeble.openNpmPackage', (item: InstalledItem) =>
        vscode.env.openExternal(
          vscode.Uri.parse(`https://www.npmjs.com/package/${item.installed.name.split('/').map(encodeURIComponent).join('/')}`),
        ),
      ),
      command('weeble.requestPackage', async () => {
        const name = (
          await vscode.window.showInputBox({
            title: 'Request npm Package',
            prompt: 'Package name',
            placeHolder: 'date-fns or @scope/package',
            validateInput: (value) => (value.trim() ? undefined : 'Enter a package name'),
          })
        )?.trim();
        if (!name) return;
        const version = (
          await vscode.window.showInputBox({
            title: `Request ${name}`,
            prompt: 'Exact version',
            placeHolder: '1.2.3',
            validateInput: (value) => (/^\d+\.\d+\.\d+$/.test(value.trim()) ? undefined : 'Enter an exact version, like 1.2.3'),
          })
        )?.trim();
        if (!version) return;
        const request = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Scanning ${name}@${version}` },
          () => weeble.api().requestPackage(name, version),
        );
        refresh(section);
        if (request.status === 'rejected') {
          const reason = request.review_reason ?? request.scan.blockers?.[0] ?? 'It is not compatible with Weeble.';
          void vscode.window.showErrorMessage(`${name}@${version} was rejected: ${reason}`);
        } else if (request.status === 'approved') {
          const choice = await vscode.window.showInformationMessage(
            `${name}@${version} passed the automated checks.`,
            'Add Package',
          );
          if (choice) await add(name, version);
        } else {
          void vscode.window.showInformationMessage(`${name}@${version} is waiting for review.`);
        }
      }),
      command('weeble.openPackageRequest', async (item?: RequestItem) => {
        if (item) return reports.open(item.request);
        const requests = await weeble.api().listMyPackageRequests();
        const picked = await vscode.window.showQuickPick(
          requests.map((request) => ({
            label: `${request.name}@${request.version}`,
            description: request.status,
            request,
          })),
          { title: 'Package Requests', placeHolder: requests.length ? undefined : 'No requests' },
        );
        if (picked) await reports.open(picked.request);
      }),
    ],
  ];
}

/** Searches approved packages as the user types, then asks for a version. */
async function pickPackage(weeble: Weeble): Promise<{ name: string; version: PackageVersionSummary } | undefined> {
  const api = weeble.api();
  const found = await new Promise<PackageCatalogItem | undefined>((resolve) => {
    const pick = vscode.window.createQuickPick<vscode.QuickPickItem & { item: PackageCatalogItem }>();
    pick.title = 'Add Package';
    pick.placeholder = 'Search approved packages';
    pick.matchOnDescription = true;
    let query = 0;
    const search = async (text: string) => {
      const current = ++query;
      pick.busy = true;
      try {
        const results = await api.searchPackages(text, 50);
        if (current !== query) return;
        pick.items = results.map((item) => ({ label: item.name, description: item.description, item }));
      } catch (error) {
        void showError(error);
      } finally {
        if (current === query) pick.busy = false;
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    pick.onDidChangeValue((text) => {
      clearTimeout(timer);
      timer = setTimeout(() => void search(text), 250);
    });
    pick.onDidAccept(() => {
      resolve(pick.selectedItems[0]?.item);
      pick.hide();
    });
    pick.onDidHide(() => {
      resolve(undefined);
      pick.dispose();
    });
    pick.show();
    void search('');
  });
  if (!found) return undefined;
  const versions = (await api.listPackageVersions(found.name)).filter((version) => version.status === 'approved');
  const version = await vscode.window.showQuickPick(
    versions.map((summary) => ({
      label: summary.version,
      description: summary.types ? 'Includes types' : undefined,
      detail: summary.description,
      summary,
    })),
    { title: found.name, placeHolder: 'Choose a version' },
  );
  return version ? { name: found.name, version: version.summary } : undefined;
}
