import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('web extension bundle', () => {
  it('exports activation through the VS Code web worker CommonJS shim', () => {
    const bundle = readFileSync(
      new URL('../dist/extension-web.js', import.meta.url),
      'utf8',
    );

    expect(bundle).toContain('exports.activate');
    expect(bundle).not.toMatch(/^\s*export\s*\{/m);
  });
});
