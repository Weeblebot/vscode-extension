import type { PackageRequest } from '@weeble/api-client';

/** A package at an exact version, as in package.json or an install link. */
export interface PackageSpec {
  name: string;
  version: string;
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parsePackageInstallUri(
  path: string,
  query: string,
): PackageSpec | null {
  if (path !== '/packages/add') return null;
  const params = new URLSearchParams(query);
  const name = params.get('name')?.trim() ?? '';
  const version = params.get('version')?.trim() ?? '';
  if (!isValidPackageName(name) || !EXACT_VERSION.test(version)) return null;
  return { name, version };
}

export function isValidPackageName(name: string): boolean {
  return PACKAGE_NAME.test(name);
}

export function parseInstalledPackages(source: string): PackageSpec[] {
  const dependencies = parsePackageJson(source).dependencies;
  if (dependencies === null || Array.isArray(dependencies) || typeof dependencies !== 'object') {
    return [];
  }
  return Object.entries(dependencies)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, version]) => ({ name, version }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Every pending request, then the most recent resolved ones. */
export function visiblePackageRequests(requests: PackageRequest[], resolvedLimit = 5): PackageRequest[] {
  const pending = requests.filter((request) => request.status === 'pending');
  const resolved = requests.filter((request) => request.status !== 'pending');
  return [...pending, ...resolved.slice(0, resolvedLimit)];
}

export function updatePackageJson(source: string, name: string, version: string): string {
  const parsed = parsePackageJson(source);
  const dependencies =
    parsed.dependencies !== null &&
    !Array.isArray(parsed.dependencies) &&
    typeof parsed.dependencies === 'object'
      ? parsed.dependencies as Record<string, unknown>
      : {};
  parsed.dependencies = Object.fromEntries(
    Object.entries({ ...dependencies, [name]: version }).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function removePackageJsonDependency(source: string, name: string): string {
  const parsed = parsePackageJson(source);
  const dependencies = parsed.dependencies;
  if (dependencies === null || Array.isArray(dependencies) || typeof dependencies !== 'object') {
    return `${JSON.stringify(parsed, null, 2)}\n`;
  }
  delete dependencies[name];
  if (Object.keys(dependencies).length === 0) delete parsed.dependencies;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function findOrphanedManagedPackages(
  previous: Record<string, string>,
  current: Record<string, string>,
): string[] {
  return Object.keys(previous)
    .filter((name) => isValidPackageName(name) && !(name in current))
    .sort((left, right) => left.localeCompare(right));
}

export function formatPackageRequestReport(request: PackageRequest): string {
  const warnings = request.scan.warnings ?? [];
  const vulnerabilities = request.scan.vulnerabilities ?? [];
  const blockers = request.scan.blockers ?? [];
  const lines = [
    `# ${request.name}@${request.version}`,
    '',
    `**Status:** ${request.status}`,
    `**Requested:** ${new Date(request.created_at * 1000).toLocaleString()}`,
    `**Runtime compatible:** ${request.scan.compatible ? 'Yes' : 'No'}`,
    `**Dependency graph:** ${request.scan.package_count} package${request.scan.package_count === 1 ? '' : 's'}`,
    '',
  ];
  if (request.reviewed_by) {
    lines.push(
      `**Decision by:** ${request.reviewed_by === 'system:package-checks' ? 'Automated package checks' : 'Weeble team'}`,
      `**Decision reason:** ${request.review_reason || 'No reason supplied'}`,
      '',
    );
  }
  if (blockers.length) {
    lines.push('## Blockers', '', ...blockers.map((value) => `- ${value}`), '');
  }
  if (request.scan.review_reasons?.length) {
    lines.push('## Needs a manual review', '', ...request.scan.review_reasons.map((value) => `- ${value}`), '');
  }
  if (vulnerabilities.length) {
    lines.push(
      '## Known vulnerabilities',
      '',
      '| Package | Advisory | Summary |',
      '| --- | --- | --- |',
      ...vulnerabilities.map(
        (item) =>
          `| ${cell(`${item.package}@${item.version}`)} | ${cell(item.id)} | ${cell(item.summary ?? '')} |`,
      ),
      '',
    );
  }
  if (warnings.length) {
    lines.push('## Review notes', '', ...warnings.map((value) => `- ${value}`), '');
  }
  lines.push(
    '## Immutable artifacts',
    '',
    '| Package | Content hash | Registry integrity | Signatures |',
    '| --- | --- | --- | ---: |',
    ...request.scan.artifacts.map(
      (artifact) =>
        `| ${cell(`${artifact.name}@${artifact.version}`)} | \`${artifact.content_hash}\` | ${artifact.registry_integrity ? `\`${artifact.registry_integrity}\`` : 'None'} | ${artifact.signature_count ?? 0} |`,
    ),
    '',
    '> Approval applies only to the exact artifacts and hashes shown above.',
  );
  return lines.join('\n');
}

function parsePackageJson(source: string): Record<string, any> {
  const parsed: unknown = source.trim() ? JSON.parse(source) : {};
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('package.json must contain an object');
  }
  return parsed as Record<string, any>;
}

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}
