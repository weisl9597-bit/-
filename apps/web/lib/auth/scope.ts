export type AuthRole = 'ADMIN' | 'REGION_MANAGER' | 'CITY_MANAGER';

export type OrganizationRecord = {
  id: string;
  path: string;
};

export type OrganizationScope = {
  role: AuthRole;
  organizationIds: string[];
  unrestricted: boolean;
};

export type AuthorizationSource = {
  role: AuthRole;
  assignedOrganizationIds: string[];
  organizations: OrganizationRecord[];
};

export type OrganizationScopeRepository = {
  findAuthorizationSource(userId: string): Promise<AuthorizationSource | null>;
};

export function resolveOrganizationScope(
  role: AuthRole,
  assignedOrganizationIds: string[],
  organizations: OrganizationRecord[],
): OrganizationScope {
  if (role === 'ADMIN') {
    return { role, organizationIds: [], unrestricted: true };
  }

  const assigned = new Set(assignedOrganizationIds);
  if (role === 'CITY_MANAGER') {
    return {
      role,
      organizationIds: organizations.filter((organization) => assigned.has(organization.id)).map(({ id }) => id),
      unrestricted: false,
    };
  }

  const assignedPaths = organizations
    .filter((organization) => assigned.has(organization.id))
    .map((organization) => organization.path);
  const organizationIds = organizations
    .filter((organization) => assignedPaths.some(
      (path) => organization.path === path || organization.path.startsWith(`${path}/`),
    ))
    .map(({ id }) => id);

  return { role, organizationIds, unrestricted: false };
}

export function applyOrganizationScope<TWhere extends Record<string, unknown>>(
  where: TWhere,
  scope: OrganizationScope,
): TWhere | { AND: [TWhere, { organizationId: { in: string[] } }] } {
  if (scope.unrestricted) return where;

  return {
    AND: [where, { organizationId: { in: scope.organizationIds } }],
  };
}

export function createOrganizationScopeService(repository: OrganizationScopeRepository) {
  return async function getOrganizationScope(userId: string): Promise<OrganizationScope> {
    const source = await repository.findAuthorizationSource(userId);
    if (!source) throw new Error('User is not authorized');

    return resolveOrganizationScope(
      source.role,
      source.assignedOrganizationIds,
      source.organizations,
    );
  };
}
