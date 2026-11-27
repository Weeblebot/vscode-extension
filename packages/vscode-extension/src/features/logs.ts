import * as vscode from 'vscode';
import type { ConsoleLogEntry } from '@weeble/api-client';
import { command, errorMessage, type Weeble } from '../weeble';

const POLL_INTERVAL_MS = 5_000;

/**
 * Streams the deployment's console output into the "Weeble Runtime" log
 * channel, where VS Code provides level filtering and search.
 */
export function registerLogs(weeble: Weeble): vscode.Disposable[] {
  const channel = vscode.window.createOutputChannel('Weeble Runtime', { log: true });
  let stream: { deployment: string; timer: ReturnType<typeof setInterval> } | undefined;

  const stop = () => {
    if (!stream) return;
    clearInterval(stream.timer);
    stream = undefined;
    void vscode.commands.executeCommand('setContext', 'weeble.streamingLogs', false);
  };

  const start = async () => {
    const project = weeble.requireProject();
    if (stream?.deployment === project.deployment) {
      channel.show(true);
      return;
    }
    stop();
    const api = weeble.api();
    let since: number | undefined;
    let failing = false;
    const poll = async () => {
      try {
        const entries = await api.getLogs(project.deployment, { limit: 200, since });
        for (const entry of [...entries].sort((a, b) => a.timestamp - b.timestamp)) {
          write(channel, entry);
          since = Math.max(since ?? entry.timestamp, entry.timestamp);
        }
        failing = false;
      } catch (error) {
        // Report the first failure of a run, not one line every 5 seconds.
        if (!failing) channel.error(`Could not load logs: ${errorMessage(error)}`);
        failing = true;
      }
    };
    channel.info(`Streaming logs for ${project.name}`);
    channel.show(true);
    await poll();
    stream = { deployment: project.deployment, timer: setInterval(() => void poll(), POLL_INTERVAL_MS) };
    void vscode.commands.executeCommand('setContext', 'weeble.streamingLogs', true);
  };

  return [
    channel,
    { dispose: stop },
    // Logs belong to one deployment and one session.
    weeble.onDidChange(() => {
      if (stream && (!weeble.signedIn || stream.deployment !== weeble.project?.deployment)) stop();
    }),
    command('weeble.logs', start),
    command('weeble.stopLogs', () => {
      stop();
      channel.info('Stopped streaming logs');
    }),
  ];
}

function write(channel: vscode.LogOutputChannel, entry: ConsoleLogEntry): void {
  const text = [entry.message ?? entry.error_message ?? '', entry.stack_trace].filter(Boolean).join('\n');
  switch (entry.level) {
    case 'error':
      channel.error(text);
      break;
    case 'warn':
      channel.warn(text);
      break;
    case 'debug':
      channel.debug(text);
      break;
    default:
      channel.info(text);
  }
}
