import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeSdkRelease } from '../../../scripts/sdk-release.mjs';

const shared = {
  bundle: true,
  sourcemap: true,
  external: ['vscode'],
  logLevel: 'info',
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ['src/extension-node.ts'],
    outfile: 'dist/extension-node.cjs',
    platform: 'node',
    format: 'cjs',
  }),
  build({
    ...shared,
    entryPoints: ['src/extension-web.ts'],
    outfile: 'dist/extension-web.js',
    platform: 'browser',
    format: 'cjs',
  }),
]);

await mkdir('dist/types', { recursive: true });
await writeSdkRelease(resolve('../..'), resolve('dist/types'));
