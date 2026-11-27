import { describe, expect, it } from 'vitest';
import { groupKvItems, kvValueLabel } from './kvView';

describe('KV view helpers', () => {
  it('groups keys by namespace and sorts them', () => {
    expect(
      groupKvItems([
        { namespace: 'users', key: 'z', value: true, cas_version: 2, ttl_ms: null },
        { namespace: 'default', key: 'wow', value: {}, cas_version: 1, ttl_ms: null },
        { namespace: 'users', key: 'a', value: 'hello', cas_version: 3, ttl_ms: 5000 },
      ]),
    ).toEqual([
      {
        namespace: 'default',
        items: [
          { namespace: 'default', key: 'wow', value: {}, cas_version: 1, ttl_ms: null },
        ],
      },
      {
        namespace: 'users',
        items: [
          { namespace: 'users', key: 'a', value: 'hello', cas_version: 3, ttl_ms: 5000 },
          { namespace: 'users', key: 'z', value: true, cas_version: 2, ttl_ms: null },
        ],
      },
    ]);
  });

  it('previews values as compact JSON', () => {
    expect(kvValueLabel({ status: 'pending' })).toBe('{"status":"pending"}');
    expect(kvValueLabel([1, 2])).toBe('[1,2]');
    expect(kvValueLabel('hello')).toBe('"hello"');
    expect(kvValueLabel(true)).toBe('true');
    expect(kvValueLabel('x'.repeat(60))).toBe(`"${'x'.repeat(38)}…`);
  });
});
