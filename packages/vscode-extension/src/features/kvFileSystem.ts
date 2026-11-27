import * as vscode from 'vscode';
import type { KvItem } from '@weeble/api-client';
import { formatEditableKv, parseEditableKv } from '../lib/kvDocument';
import { errorMessage } from '../weeble';

interface KvDocumentRecord {
  namespace: string;
  key: string;
  casVersion?: number;
  contents: Uint8Array;
  createdAt: number;
  modifiedAt: number;
}

export class KvFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changed.event;
  private readonly documents = new Map<string, KvDocumentRecord>();

  constructor(
    private readonly save: (input: {
      namespace: string;
      key: string;
      value: unknown;
      ttlMs: number | null;
      expectedCasVersion?: number;
    }) => Promise<KvItem>,
    private readonly onValidation: (uri: vscode.Uri, message?: string) => void,
    private readonly onSaved: () => void,
  ) {}

  open(item: KvItem): vscode.Uri {
    return this.register(
      item.namespace,
      item.key,
      { value: item.value, ttlMs: item.ttl_ms },
      item.cas_version,
    );
  }

  create(namespace: string, key: string): vscode.Uri {
    return this.register(namespace, key, { value: null, ttlMs: null }, 0);
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const record = this.required(uri);
    return {
      type: vscode.FileType.File,
      ctime: record.createdAt,
      mtime: record.modifiedAt,
      size: record.contents.byteLength,
    };
  }

  readFile(uri: vscode.Uri): Uint8Array {
    return this.required(uri).contents;
  }

  async writeFile(uri: vscode.Uri, contents: Uint8Array): Promise<void> {
    const record = this.required(uri);
    const source = new TextDecoder().decode(contents);
    let parsed;
    try {
      parsed = parseEditableKv(source);
    } catch (error) {
      this.onValidation(uri, errorMessage(error));
      throw vscode.FileSystemError.Unavailable(errorMessage(error));
    }
    try {
      const saved = await this.save({
        namespace: record.namespace,
        key: record.key,
        value: parsed.value,
        ttlMs: parsed.ttlMs,
        expectedCasVersion: record.casVersion,
      });
      record.casVersion = saved.cas_version;
      record.contents = contents.slice();
      record.modifiedAt = Date.now();
      this.onValidation(uri);
      this.onSaved();
      this.changed.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    } catch (error) {
      this.onValidation(uri, errorMessage(error));
      throw vscode.FileSystemError.Unavailable(errorMessage(error));
    }
  }

  readDirectory(): [string, vscode.FileType][] {
    throw vscode.FileSystemError.NoPermissions('KV documents do not expose directories');
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('KV documents do not expose directories');
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions('Delete KV entries from the Weeble sidebar');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('KV namespace and key cannot be renamed');
  }

  private register(
    namespace: string,
    key: string,
    value: { value: unknown; ttlMs: number | null },
    casVersion?: number,
  ): vscode.Uri {
    const uri = vscode.Uri.from({
      scheme: 'weeble-kv-edit',
      path: `/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}.json`,
    });
    const now = Date.now();
    this.documents.set(uri.toString(), {
      namespace,
      key,
      casVersion,
      contents: new TextEncoder().encode(formatEditableKv(value)),
      createdAt: now,
      modifiedAt: now,
    });
    return uri;
  }

  private required(uri: vscode.Uri): KvDocumentRecord {
    const record = this.documents.get(uri.toString());
    if (!record) throw vscode.FileSystemError.FileNotFound(uri);
    return record;
  }
}
