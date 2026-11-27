import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Manifest {
  contributes: {
    commands: Array<{ command: string; title: string; category?: string; icon?: string }>;
    menus: Record<string, Array<{ command: string; when?: string; group?: string }>>;
    views: Record<string, Array<{ id: string; name: string }>>;
    viewsWelcome: Array<{ view: string; when: string; contents: string }>;
  };
}

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as Manifest;
const { commands, menus, views, viewsWelcome } = manifest.contributes;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

const registered = new Set(
  sourceFiles(resolve(process.cwd(), 'src')).flatMap((path) =>
    [...readFileSync(path, 'utf8').matchAll(/command\('(weeble\.[A-Za-z]+)'/g)].map((match) => match[1]),
  ),
);

describe('extension manifest', () => {
  it('declares every registered command and registers every declared one', () => {
    const declared = new Set(commands.map((command) => command.command));
    expect([...registered].sort()).toEqual([...declared].sort());
  });

  it('only references declared commands in menus', () => {
    const declared = new Set(commands.map((command) => command.command));
    for (const entries of Object.values(menus)) {
      for (const entry of entries) expect(declared).toContain(entry.command);
    }
  });

  it('puts every command in the Weeble category', () => {
    for (const command of commands) expect(command.category).toBe('Weeble');
  });

  it('uses one sidebar view with welcome screens for each missing step', () => {
    expect(views.weeble).toEqual([{ id: 'weeble.sidebar', name: 'Weeble' }]);
    expect(viewsWelcome.map((welcome) => welcome.when)).toEqual([
      'workbenchState == empty',
      'workbenchState != empty && !weeble.signedIn',
      'workbenchState != empty && weeble.signedIn && !weeble.hasProject',
    ]);
  });

  it('offers deploy from the editor title and the sidebar', () => {
    expect(menus['editor/title']).toContainEqual(expect.objectContaining({ command: 'weeble.deploy' }));
    expect(menus['view/title']).toContainEqual(
      expect.objectContaining({ command: 'weeble.deploy', group: 'navigation@1' }),
    );
  });

  it('keeps destructive item actions out of the inline buttons', () => {
    const inline = menus['view/item/context'].filter((entry) => entry.group?.startsWith('inline'));
    for (const entry of inline) {
      expect(['weeble.deleteKvItem', 'weeble.deleteKvNamespace', 'weeble.uninstallPackage']).not.toContain(
        entry.command,
      );
    }
  });

  it('hides item-only commands from the command palette', () => {
    const hidden = menus.commandPalette.filter((entry) => entry.when === 'false').map((entry) => entry.command);
    expect(hidden).toEqual(
      expect.arrayContaining(['weeble.copyKvValue', 'weeble.deleteKvItem', 'weeble.uninstallPackage']),
    );
  });
});
