import * as vscode from 'vscode';
import { pollDeviceAuthorization } from '../lib/deviceLogin';
import { command, type Weeble } from '../weeble';

const SCOPES = [
  'deployments:publish',
  'deployments:read',
  'guilds:read',
  'kv:read',
  'kv:write',
  'logs:read',
  'packages:read',
  'packages:write',
];

export function registerAuth(weeble: Weeble): vscode.Disposable[] {
  return [
    command('weeble.signIn', async () => {
      const method = await vscode.window.showQuickPick(
        [
          { label: 'Continue in browser', description: 'Recommended', browser: true },
          { label: 'Enter API key', description: 'Use a key from Weeble Settings', browser: false },
        ],
        { title: 'Sign in to Weeble' },
      );
      if (!method) return;
      const username = method.browser ? await signInWithBrowser(weeble) : await signInWithKey(weeble);
      if (username) void vscode.window.showInformationMessage(`Signed in to Weeble as ${username}.`);
    }),
    command('weeble.enterApiKey', async () => {
      const username = await signInWithKey(weeble);
      if (username) void vscode.window.showInformationMessage(`Signed in to Weeble as ${username}.`);
    }),
    command('weeble.signOut', async () => {
      await weeble.signOut();
      void vscode.window.showInformationMessage('Signed out of Weeble.');
    }),
  ];
}

async function signInWithBrowser(weeble: Weeble): Promise<string | undefined> {
  const api = weeble.anonymousApi();
  const device = await api.createDeviceAuthorization('VS Code', SCOPES);
  await vscode.env.openExternal(
    vscode.Uri.parse(`${device.verificationUri}?code=${encodeURIComponent(device.userCode)}`),
  );
  const token = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Approve Weeble access in your browser (code ${device.userCode})`,
      cancellable: true,
    },
    async (_progress, cancel) => {
      try {
        return await pollDeviceAuthorization(api, device, {
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          // Ends the wait early when the user cancels.
          now: () => (cancel.isCancellationRequested ? Number.POSITIVE_INFINITY : Date.now()),
        });
      } catch (error) {
        if (cancel.isCancellationRequested) return undefined;
        throw error;
      }
    },
  );
  return token ? signInAs(weeble, token.accessToken) : undefined;
}

async function signInWithKey(weeble: Weeble): Promise<string | undefined> {
  const key = (
    await vscode.window.showInputBox({
      title: 'Enter Weeble API key',
      prompt: 'Create a key in the dashboard under Settings > API keys.',
      placeHolder: 'wbl_...',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim().startsWith('wbl_') ? undefined : 'Weeble API keys start with wbl_.'),
    })
  )?.trim();
  return key ? signInAs(weeble, key) : undefined;
}

/** Stores the token and returns the account's username, or signs out again if the token doesn't work. */
async function signInAs(weeble: Weeble, token: string): Promise<string> {
  await weeble.signIn(token);
  try {
    return (await weeble.identity()).username;
  } catch (error) {
    await weeble.signOut();
    throw error;
  }
}
