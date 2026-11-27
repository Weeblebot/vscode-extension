import { describe, expect, it } from 'vitest';
import { formatEditableKv, parseEditableKv } from './kvDocument';

describe('editable KV documents', () => {
  it('formats only editable fields', () => {
    expect(formatEditableKv({ value: { enabled: true }, ttlMs: null })).toBe(
      '{\n  "value": {\n    "enabled": true\n  },\n  "ttlMs": null\n}\n',
    );
  });

  it('parses JSON values and TTLs', () => {
    expect(parseEditableKv('{"value":[1,2],"ttlMs":5000}')).toEqual({
      value: [1, 2],
      ttlMs: 5000,
    });
  });

  it('rejects missing values and invalid TTLs', () => {
    expect(() => parseEditableKv('{"ttlMs":null}')).toThrow('value field');
    expect(() => parseEditableKv('{"value":true,"ttlMs":100}')).toThrow(
      'ttlMs must be null or an integer of at least 1000',
    );
  });
});
