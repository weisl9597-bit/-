import { describe, expect, it } from 'vitest';

const organizations = [
  { id: 'national', path: '/china' },
  { id: 'region-south', path: '/china/south' },
  { id: 'city-shenzhen', path: '/china/south/shenzhen' },
  { id: 'city-guangzhou', path: '/china/south/guangzhou' },
  { id: 'region-east', path: '/china/east' },
  { id: 'city-hangzhou', path: '/china/east/hangzhou' },
];

describe('organization authorization scope', () => {
  it('limits a city manager to the assigned city', async () => {
    const module = await import('../lib/auth/scope').catch(() => ({}));
    expect(module).toHaveProperty('resolveOrganizationScope');

    const scope = (module as typeof import('../lib/auth/scope')).resolveOrganizationScope(
      'CITY_MANAGER',
      ['city-shenzhen'],
      organizations,
    );
    expect(scope).toEqual({
      role: 'CITY_MANAGER',
      organizationIds: ['city-shenzhen'],
      unrestricted: false,
    });
  });

  it('includes descendant cities for a regional manager', async () => {
    const { resolveOrganizationScope } = await import('../lib/auth/scope');
    const scope = resolveOrganizationScope('REGION_MANAGER', ['region-south'], organizations);

    expect(scope.organizationIds).toEqual(['region-south', 'city-shenzhen', 'city-guangzhou']);
    expect(scope.organizationIds).not.toContain('city-hangzhou');
  });

  it('keeps an existing query filter and adds a mandatory scope filter', async () => {
    const { applyOrganizationScope } = await import('../lib/auth/scope');
    const result = applyOrganizationScope(
      { active: true, organizationId: 'city-hangzhou' },
      { role: 'CITY_MANAGER', organizationIds: ['city-shenzhen'], unrestricted: false },
    );

    expect(result).toEqual({
      AND: [
        { active: true, organizationId: 'city-hangzhou' },
        { organizationId: { in: ['city-shenzhen'] } },
      ],
    });
  });

  it('does not constrain an administrator query', async () => {
    const { applyOrganizationScope, resolveOrganizationScope } = await import('../lib/auth/scope');
    const scope = resolveOrganizationScope('ADMIN', [], organizations);

    expect(scope.unrestricted).toBe(true);
    expect(applyOrganizationScope({ active: true }, scope)).toEqual({ active: true });
  });

  it('loads authorization data through the scope service boundary', async () => {
    const module = await import('../lib/auth/scope').catch(() => ({}));
    expect(module).toHaveProperty('createOrganizationScopeService');
    const { createOrganizationScopeService } = module as typeof import('../lib/auth/scope');
    const getOrganizationScope = createOrganizationScopeService({
      async findAuthorizationSource(userId: string) {
        expect(userId).toBe('region-user');
        return {
          role: 'REGION_MANAGER',
          assignedOrganizationIds: ['region-south'],
          organizations,
        };
      },
    });

    await expect(getOrganizationScope('region-user')).resolves.toMatchObject({
      organizationIds: ['region-south', 'city-shenzhen', 'city-guangzhou'],
      unrestricted: false,
    });
  });

  it('rejects a missing or inactive user at the scope service boundary', async () => {
    const { createOrganizationScopeService } = await import('../lib/auth/scope');
    const getOrganizationScope = createOrganizationScopeService({
      async findAuthorizationSource() {
        return null;
      },
    });

    await expect(getOrganizationScope('inactive-user')).rejects.toThrow('User is not authorized');
  });
});
