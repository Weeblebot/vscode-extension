import { describe, expect, it } from 'vitest';
import type { PackageRequest } from '@weeble/api-client';
import {
  formatPackageRequestReport,
  findOrphanedManagedPackages,
  parsePackageInstallUri,
  parseInstalledPackages,
  removePackageJsonDependency,
  updatePackageJson,
  visiblePackageRequests,
} from './packageCatalog';

describe('package catalog', () => {
  it('parses an exact package install link', () => {
    expect(
      parsePackageInstallUri(
        '/packages/add',
        'name=%40scope%2Ftools&version=2.1.0-beta.1',
      ),
    ).toEqual({ name: '@scope/tools', version: '2.1.0-beta.1' });
  });

  it('rejects malformed package install links', () => {
    expect(parsePackageInstallUri('/packages/add', 'name=query-string&version=latest')).toBeNull();
    expect(parsePackageInstallUri('/other', 'name=query-string&version=9.4.1')).toBeNull();
  });

  it('adds an exact dependency without disturbing project metadata', () => {
    const updated = JSON.parse(
      updatePackageJson(
        JSON.stringify({ name: 'my-bot', private: true, dependencies: { zod: '4.0.0' } }),
        'date-fns',
        '4.1.0',
      ),
    );

    expect(updated).toEqual({
      name: 'my-bot',
      private: true,
      dependencies: { 'date-fns': '4.1.0', zod: '4.0.0' },
    });
  });

  it('renders the scan results for the person who requested it', () => {
    const request: PackageRequest = {
      id: 'pkgr_1',
      name: 'date-fns',
      version: '4.1.0',
      requester_id: 'user_1',
      status: 'rejected',
      created_at: 1,
      reviewed_by: 'staff_42',
      review_reason: 'Needs Node.js',
      scan: {
        compatible: true,
        package_count: 1,
        artifacts: [
          {
            name: 'date-fns',
            version: '4.1.0',
            content_hash: 'abc123',
            registry_integrity: 'sha512-registry',
            signature_count: 1,
          },
        ],
        warnings: ['No provenance attestation'],
        vulnerabilities: [
          { package: 'date-fns', version: '4.1.0', id: 'GHSA-test', summary: 'Example' },
        ],
      },
    };

    const report = formatPackageRequestReport(request);

    expect(report).toContain('date-fns@4.1.0');
    expect(report).toContain('sha512-registry');
    expect(report).toContain('GHSA-test');
    expect(report).toContain('No provenance attestation');
    expect(report).toContain('**Decision by:** Weeble team');
    expect(report).not.toContain('user_1');
    expect(report).not.toContain('staff_42');
  });

  it('removes an installed dependency without disturbing project metadata', () => {
    const updated = JSON.parse(
      removePackageJsonDependency(
        JSON.stringify({ name: 'my-bot', private: true, dependencies: { zod: '4.0.0' } }),
        'zod',
      ),
    );

    expect(updated).toEqual({ name: 'my-bot', private: true });
  });

  it('only cleans artifacts previously managed by Weeble', () => {
    expect(
      findOrphanedManagedPackages(
        { app: '1.0.0', shared: '2.0.0', orphan: '3.0.0' },
        { app: '1.0.0', shared: '2.0.0' },
      ),
    ).toEqual(['orphan']);
  });

  it('never treats unsafe manifest paths as managed package names', () => {
    expect(
      findOrphanedManagedPackages(
        { '../outside': '1.0.0', safe: '1.0.0' },
        {},
      ),
    ).toEqual(['safe']);
  });

  it('keeps pending requests visible and limits resolved sidebar history', () => {
    const request = (
      id: string,
      status: PackageRequest['status'],
      createdAt: number,
    ): PackageRequest => ({
      id,
      name: `package-${id}`,
      version: '1.0.0',
      requester_id: 'user_1',
      status,
      created_at: createdAt,
      scan: { compatible: true, package_count: 1, artifacts: [] },
    });
    const requests = [
      request('pending-old', 'pending', 1),
      ...Array.from({ length: 7 }, (_, index) =>
        request(`resolved-${index}`, index % 2 ? 'approved' : 'rejected', 20 - index),
      ),
      request('pending-new', 'pending', 30),
    ];

    expect(visiblePackageRequests(requests, 5).map((item) => item.id)).toEqual([
      'pending-old',
      'pending-new',
      'resolved-0',
      'resolved-1',
      'resolved-2',
      'resolved-3',
      'resolved-4',
    ]);
  });

  it('reads installed workspace dependencies in name order', () => {
    expect(
      parseInstalledPackages(JSON.stringify({
        dependencies: {
          zod: '4.3.3',
          '@scope/tools': '2.0.0',
        },
        devDependencies: { vitest: '4.1.0' },
      })),
    ).toEqual([
      { name: '@scope/tools', version: '2.0.0' },
      { name: 'zod', version: '4.3.3' },
    ]);
  });
});
