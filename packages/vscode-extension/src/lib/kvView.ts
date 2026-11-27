import type { KvItem } from '@weeble/api-client';

export interface KvNamespaceGroup {
  namespace: string;
  items: KvItem[];
}

export function groupKvItems(items: KvItem[]): KvNamespaceGroup[] {
  const grouped = new Map<string, KvItem[]>();
  for (const item of items) {
    const namespace = grouped.get(item.namespace) ?? [];
    namespace.push(item);
    grouped.set(item.namespace, namespace);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([namespace, namespaceItems]) => ({
      namespace,
      items: namespaceItems.sort((left, right) => left.key.localeCompare(right.key)),
    }));
}

/** A one-line preview of a value, cut to 40 characters. */
export function kvValueLabel(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}
