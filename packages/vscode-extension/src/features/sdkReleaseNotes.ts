import * as vscode from 'vscode';
import type { SdkManifest } from '../lib/sdkUpdate';

export const LAST_SHOWN_SDK_RELEASE_KEY = 'weeble.sdkReleaseNotes.lastShownVersion';

export class SdkReleaseNotesProvider implements vscode.TextDocumentContentProvider {
  private readonly documents = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) ?? '';
  }

  async show(release: SdkManifest): Promise<void> {
    const uri = vscode.Uri.from({
      scheme: 'weeble-sdk-release-notes',
      path: `/Weeble SDK ${release.version}.md`,
    });
    this.documents.set(uri.toString(), releaseNotesDocument(release));
    await vscode.commands.executeCommand('markdown.showPreview', uri);
  }
}

function releaseNotesDocument(release: SdkManifest): string {
  const notes = release.releaseNotes?.trim();
  const releaseUrl = safeReleaseUrl(release.githubReleaseUrl);
  // Early releases had only "See <link>" as their notes; show the link instead.
  const legacyLinkOnly = notes !== undefined && /^See https?:\/\/\S+$/i.test(notes);
  const body = notes && !legacyLinkOnly
    ? notes
    : releaseUrl
      ? 'Read the full notes for this release on GitHub.'
      : 'No release notes were included with this SDK version.';
  const link = releaseUrl ? `\n\n[View this release on GitHub](${releaseUrl})` : '';
  return `# Weeble SDK ${release.version}\n\n${body}${link}\n`;
}

function safeReleaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
