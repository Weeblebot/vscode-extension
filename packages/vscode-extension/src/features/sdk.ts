import * as vscode from 'vscode';
import {
  downloadSdkRelease,
  fetchSdkManifest,
  hasSdkUpdate,
  installSdkRelease,
  isMajorSdkUpdate,
  readInstalledSdk,
  sdkManifestUrl,
  sdkReleaseManifestUrl,
  type SdkManifest,
} from '../lib/sdkUpdate';
import { command, errorMessage, type Weeble } from '../weeble';
import { LAST_SHOWN_SDK_RELEASE_KEY, SdkReleaseNotesProvider } from './sdkReleaseNotes';

/**
 * Keeps the SDK declarations in `.weeble/types` current. A newer release is
 * offered once per session when the project opens, and on request.
 */
export function registerSdk(weeble: Weeble, context: vscode.ExtensionContext): vscode.Disposable[] {
  const notes = new SdkReleaseNotesProvider();
  const manifestUrl = () => sdkManifestUrl(weeble.apiUrl);

  /** The newer release, if there is one, and whether it is a major update. */
  const available = async (): Promise<{ release: SdkManifest; major: boolean } | undefined> => {
    const latest = await fetchSdkManifest(fetch, manifestUrl());
    const installed = await readInstalledSdk(weeble.files);
    if (!hasSdkUpdate(installed, latest)) return undefined;
    return { release: latest, major: isMajorSdkUpdate(installed, latest) };
  };

  const install = async (release: SdkManifest) => {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Updating Weeble SDK to ${release.version}` },
      async () => installSdkRelease(weeble.files, await downloadSdkRelease(fetch, manifestUrl(), release)),
    );
    await vscode.commands.executeCommand('typescript.restartTsServer');
    weeble.invalidate();
    if (context.globalState.get(LAST_SHOWN_SDK_RELEASE_KEY) !== release.version) {
      await context.globalState.update(LAST_SHOWN_SDK_RELEASE_KEY, release.version);
      await notes.show(release).catch((error) => weeble.log.warn(`Could not show release notes: ${errorMessage(error)}`));
    }
  };

  const offer = async ({ release, major }: { release: SdkManifest; major: boolean }) => {
    // A major release can break existing scripts, so it leads with the notes.
    const choice = major
      ? await vscode.window.showWarningMessage(
          `Weeble SDK ${release.version} has breaking changes. Read the release notes before you update.`,
          'Release Notes',
          'Update',
        )
      : await vscode.window.showInformationMessage(`Weeble SDK ${release.version} is available.`, 'Update', 'Release Notes');
    if (choice === 'Update') await install(release);
    if (choice === 'Release Notes') await notes.show(release);
  };

  let offered = false;
  const checkOnOpen = () => {
    if (offered || !weeble.project) return;
    offered = true;
    void available()
      .then((update) => update && offer(update))
      .catch((error) => weeble.log.warn(`SDK update check failed: ${errorMessage(error)}`));
  };
  checkOnOpen();

  return [
    vscode.workspace.registerTextDocumentContentProvider('weeble-sdk-release-notes', notes),
    weeble.onDidChange(checkOnOpen),
    command('weeble.checkSdkUpdates', async () => {
      weeble.requireProject();
      const update = await available();
      if (update) return offer(update);
      const installed = await readInstalledSdk(weeble.files);
      void vscode.window.showInformationMessage(
        installed ? `Weeble SDK ${installed.version} is up to date.` : 'The Weeble SDK is up to date.',
      );
    }),
    command('weeble.updateSdk', async () => {
      weeble.requireProject();
      const update = await available();
      if (update) await install(update.release);
      else void vscode.window.showInformationMessage('The Weeble SDK is up to date.');
    }),
    command('weeble.showSdkReleaseNotes', async () => {
      const installed = await readInstalledSdk(weeble.files);
      if (!installed) throw new Error('No Weeble SDK is installed in this folder.');
      await notes.show(await fetchSdkManifest(fetch, sdkReleaseManifestUrl(weeble.apiUrl, installed.version)));
    }),
  ];
}
