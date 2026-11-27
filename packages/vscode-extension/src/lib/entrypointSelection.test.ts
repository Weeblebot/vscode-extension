import { describe, expect, it } from 'vitest';
import {
  entrypointCandidates,
  normalizeEntrypointPath,
  updateProjectEntrypoint,
} from './entrypointSelection';

describe('normalizeEntrypointPath', () => {
  it('strips relative prefixes and backslashes', () => {
    expect(normalizeEntrypointPath('./src/main.ts')).toBe('src/main.ts');
    expect(normalizeEntrypointPath('/main.ts')).toBe('main.ts');
    expect(normalizeEntrypointPath('src\\main.ts')).toBe('src/main.ts');
  });

  it('rejects empty and escaping paths', () => {
    expect(normalizeEntrypointPath('')).toBeUndefined();
    expect(normalizeEntrypointPath('../secret.ts')).toBeUndefined();
    expect(normalizeEntrypointPath('src/../secret.ts')).toBeUndefined();
  });
});

describe('entrypointCandidates', () => {
  it('keeps deployable sources and drops support/ignored files', () => {
    expect(
      entrypointCandidates([
        'main.ts',
        'src/bot.ts',
        'data/config.json',
        'package.json',
        'tsconfig.json',
        '.weeble/types/runtime.d.ts',
        'node_modules/ms/index.js',
        'dist/main.js',
        'notes.txt',
        'logo.png',
      ]),
    ).toEqual(['data/config.json', 'main.ts', 'src/bot.ts']);
  });

  it('dedupes equivalent spellings', () => {
    expect(entrypointCandidates(['./main.ts', 'main.ts'])).toEqual(['main.ts']);
  });
});

describe('updateProjectEntrypoint', () => {
  const source = JSON.stringify({
    version: 1,
    name: 'main',
    deployment: 'dep_1',
    guild: '1499787962874069002',
    entrypoint: 'main.ts',
    files: ['main.ts'],
    dependencies: {},
  });

  it('updates the entrypoint while preserving other fields', () => {
    const updated = JSON.parse(updateProjectEntrypoint(source, 'src/bot.ts'));
    expect(updated.entrypoint).toBe('src/bot.ts');
    expect(updated.name).toBe('main');
    expect(updated.deployment).toBe('dep_1');
    expect(updated.dependencies).toEqual({});
  });

  it('adds a new entrypoint to the managed files', () => {
    const updated = JSON.parse(updateProjectEntrypoint(source, 'src/bot.ts'));
    expect(updated.files).toEqual(['main.ts', 'src/bot.ts']);
  });

  it('leaves the files list untouched when already managed', () => {
    const updated = JSON.parse(updateProjectEntrypoint(source, './main.ts'));
    expect(updated.files).toEqual(['main.ts']);
  });

  it('rejects invalid metadata and paths', () => {
    expect(() => updateProjectEntrypoint('not json', 'main.ts')).toThrow(
      'Invalid .weeble/project.json',
    );
    expect(() => updateProjectEntrypoint(source, '../secret.ts')).toThrow(
      'Invalid entrypoint path',
    );
  });
});
