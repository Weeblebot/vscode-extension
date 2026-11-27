import * as vscode from 'vscode';
import type { WeebleApiClient } from '@weeble/api-client';
import {
  findOrphanedManagedPackages,
  isValidPackageName,
  parseInstalledPackages,
  removePackageJsonDependency,
  updatePackageJson,
} from '../lib/packageCatalog';

// Approved packages are written into node_modules so the editor has their
// types. `.weeble/package-artifacts.json` records which ones Weeble wrote, so
// sync can remove them again without touching anything else.

export async function installApprovedPackage(
  root: vscode.Uri,
  api: WeebleApiClient,
  name: string,
  version: string,
): Promise<number> {
  const packageJsonUri = vscode.Uri.joinPath(root, 'package.json');
  const source = await readTextFile(packageJsonUri, '{}');
  const updated = updatePackageJson(source, name, version);
  await vscode.workspace.fs.writeFile(packageJsonUri, new TextEncoder().encode(updated));
  return synchronizeApprovedPackages(root, api);
}

export async function uninstallApprovedPackage(
  root: vscode.Uri,
  api: WeebleApiClient,
  name: string,
): Promise<number> {
  const packageJsonUri = vscode.Uri.joinPath(root, 'package.json');
  const source = await readTextFile(packageJsonUri, '{}');
  const removed = parseInstalledPackages(source).find((entry) => entry.name === name);
  if (removed) {
    const managed = await readManagedPackageManifest(root);
    await writeManagedPackageManifest(root, { ...managed, [name]: removed.version });
  }
  const updated = removePackageJsonDependency(source, name);
  await vscode.workspace.fs.writeFile(packageJsonUri, new TextEncoder().encode(updated));
  return synchronizeApprovedPackages(root, api);
}

export async function synchronizeApprovedPackages(
  root: vscode.Uri,
  api: WeebleApiClient,
): Promise<number> {
  const packageJsonUri = vscode.Uri.joinPath(root, 'package.json');
  const source = await readTextFile(packageJsonUri, '{}');
  const dependencies = Object.fromEntries(
    parseInstalledPackages(source).map((entry) => [entry.name, entry.version]),
  );
  const resolution = Object.keys(dependencies).length
    ? await api.resolvePackages(dependencies)
    : { resolved: {}, versions: {} };
  for (const [packageName, exactVersion] of Object.entries(resolution.resolved)) {
    const downloaded = await api.getPackageVersion(packageName, exactVersion);
    if (downloaded.content_hash !== resolution.versions[packageName]?.content_hash) {
      throw new Error(`Package content changed while installing ${packageName}@${exactVersion}`);
    }
    await writePackageFiles(root, packageName, downloaded.files);
  }
  const previous = await readManagedPackageManifest(root);
  const orphans = findOrphanedManagedPackages(previous, resolution.resolved);
  for (const packageName of orphans) {
    await deletePackageFiles(root, packageName);
  }
  await writeManagedPackageManifest(root, resolution.resolved);
  return Object.keys(resolution.resolved).length;
}

async function writePackageFiles(
  root: vscode.Uri,
  packageName: string,
  files: Record<string, string>,
): Promise<void> {
  const packageRoot = vscode.Uri.joinPath(root, 'node_modules', ...packageName.split('/'));
  await deletePackageFiles(root, packageName);
  for (const [path, contents] of Object.entries(files)) {
    const parts = path.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`Package contains an unsafe path: ${path}`);
    }
    const target = vscode.Uri.joinPath(packageRoot, ...parts);
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(packageRoot, ...parts.slice(0, -1)),
    );
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(contents));
  }
}

async function deletePackageFiles(root: vscode.Uri, packageName: string): Promise<void> {
  if (!isValidPackageName(packageName)) {
    throw new Error(`Package has an unsafe name: ${packageName}`);
  }
  const packageRoot = vscode.Uri.joinPath(root, 'node_modules', ...packageName.split('/'));
  try {
    await vscode.workspace.fs.delete(packageRoot, { recursive: true });
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error;
  }
}

async function readManagedPackageManifest(root: vscode.Uri): Promise<Record<string, string>> {
  const uri = vscode.Uri.joinPath(root, '.weeble', 'package-artifacts.json');
  const source = await readTextFile(uri, '{"packages":{}}');
  const parsed = JSON.parse(source) as { packages?: unknown };
  if (!parsed.packages || Array.isArray(parsed.packages) || typeof parsed.packages !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(parsed.packages).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

async function writeManagedPackageManifest(
  root: vscode.Uri,
  packages: Record<string, string>,
): Promise<void> {
  const directory = vscode.Uri.joinPath(root, '.weeble');
  await vscode.workspace.fs.createDirectory(directory);
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(directory, 'package-artifacts.json'),
    new TextEncoder().encode(`${JSON.stringify({ version: 1, packages }, null, 2)}\n`),
  );
}

async function readTextFile(uri: vscode.Uri, fallback: string): Promise<string> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return fallback;
    throw error;
  }
}
