import * as vscode from 'vscode';
import type { KvItem } from '@weeble/api-client';
import { groupKvItems, kvValueLabel } from '../lib/kvView';
import type { Parent, Section } from '../sidebar';
import { command, type Weeble } from '../weeble';
import { KvFileSystemProvider } from './kvFileSystem';

class NamespaceItem extends vscode.TreeItem implements Parent {
  constructor(
    readonly namespace: string,
    readonly items: KvItem[],
  ) {
    super(namespace, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `kv:${namespace}`;
    this.description = String(items.length);
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
    this.contextValue = 'weeble.kvNamespace';
  }

  async children(): Promise<vscode.TreeItem[]> {
    return this.items.map((item) => new KeyItem(item));
  }
}

class KeyItem extends vscode.TreeItem {
  constructor(readonly item: KvItem) {
    super(item.key);
    this.id = `kv:${item.namespace}:${item.key}`;
    this.description = kvValueLabel(item.value);
    this.tooltip = `${item.namespace}/${item.key}`;
    this.iconPath = new vscode.ThemeIcon('key');
    this.contextValue = 'weeble.kvKey';
    this.command = { command: 'weeble.openKvItem', title: 'Open', arguments: [this] };
  }
}

export function kvSection(weeble: Weeble, refresh: (section: Section) => void): [Section, vscode.Disposable[]] {
  const problems = vscode.languages.createDiagnosticCollection('weeble-kv');
  const section: Section = {
    label: 'KV',
    contextValue: 'weeble.kv',
    async children() {
      const items = await weeble.api().listKv(weeble.requireProject().deployment);
      return groupKvItems(items).map((group) => new NamespaceItem(group.namespace, group.items));
    },
  };
  const documents = new KvFileSystemProvider(
    (input) => weeble.api().putKv(weeble.requireProject().deployment, input),
    (uri, message) => {
      if (message === undefined) {
        problems.delete(uri);
        return;
      }
      const diagnostic = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), message, vscode.DiagnosticSeverity.Error);
      diagnostic.source = 'Weeble KV';
      problems.set(uri, [diagnostic]);
    },
    () => refresh(section),
  );

  const create = async (namespace?: string) => {
    namespace ??= (
      await vscode.window.showInputBox({
        title: 'New KV Entry',
        prompt: 'Namespace',
        validateInput: (value) => (value.trim() ? undefined : 'Enter a namespace'),
      })
    )?.trim();
    if (!namespace) return;
    const key = (
      await vscode.window.showInputBox({
        title: 'New KV Entry',
        prompt: `Key in ${namespace}`,
        validateInput: (value) => (value.trim() ? undefined : 'Enter a key'),
      })
    )?.trim();
    if (!key) return;
    await vscode.window.showTextDocument(documents.create(namespace, key), { preview: false });
  };

  return [
    section,
    [
      problems,
      vscode.workspace.registerFileSystemProvider('weeble-kv-edit', documents, { isCaseSensitive: true }),
      command('weeble.openKvItem', (key: KeyItem) => vscode.window.showTextDocument(documents.open(key.item))),
      command('weeble.createKvItem', () => create()),
      command('weeble.createKvItemInNamespace', (item: NamespaceItem) => create(item.namespace)),
      command('weeble.copyKvNamespace', (item: NamespaceItem) => vscode.env.clipboard.writeText(item.namespace)),
      command('weeble.copyKvKey', (key: KeyItem) => vscode.env.clipboard.writeText(key.item.key)),
      command('weeble.copyKvValue', (key: KeyItem) =>
        vscode.env.clipboard.writeText(
          typeof key.item.value === 'string' ? key.item.value : JSON.stringify(key.item.value, null, 2),
        ),
      ),
      command('weeble.deleteKvItem', async (key: KeyItem) => {
        const { namespace, key: name } = key.item;
        const choice = await vscode.window.showWarningMessage(
          `Delete ${namespace}/${name}?`,
          { modal: true },
          'Delete',
        );
        if (!choice) return;
        await weeble.api().deleteKv(weeble.requireProject().deployment, namespace, name);
        refresh(section);
      }),
      command('weeble.deleteKvNamespace', async (item: NamespaceItem) => {
        const count = item.items.length;
        const typed = await vscode.window.showInputBox({
          title: `Delete namespace ${item.namespace}`,
          prompt: `Type ${item.namespace} to delete ${count} ${count === 1 ? 'key' : 'keys'} for good.`,
          validateInput: (value) => (value === item.namespace ? undefined : `Type ${item.namespace} to confirm`),
        });
        if (typed !== item.namespace) return;
        await weeble.api().deleteKvNamespace(weeble.requireProject().deployment, item.namespace);
        refresh(section);
      }),
    ],
  ];
}
