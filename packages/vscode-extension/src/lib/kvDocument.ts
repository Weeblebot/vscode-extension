export interface EditableKvValue {
  value: unknown;
  ttlMs: number | null;
}

export function formatEditableKv(input: EditableKvValue): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

export function parseEditableKv(source: string): EditableKvValue {
  const document = JSON.parse(source) as Record<string, unknown>;
  if (
    document === null
    || typeof document !== 'object'
    || Array.isArray(document)
    || !Object.hasOwn(document, 'value')
  ) {
    throw new Error('KV document must contain a value field');
  }
  const ttlMs = document.ttlMs ?? null;
  if (
    ttlMs !== null
    && (!Number.isInteger(ttlMs) || (ttlMs as number) < 1000)
  ) {
    throw new Error('ttlMs must be null or an integer of at least 1000');
  }
  return { value: document.value, ttlMs: ttlMs as number | null };
}
