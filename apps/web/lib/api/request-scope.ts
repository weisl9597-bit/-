import { authenticateRequest } from '../auth/request-actor';
import { prismaScopeRepository } from '../auth/prisma-repositories';
import { createOrganizationScopeService, type OrganizationScope } from '../auth/scope';

const getOrganizationScope = createOrganizationScopeService(prismaScopeRepository);

export async function resolveRequestScope(request: Request): Promise<
  { scope: OrganizationScope } | { response: Response }
> {
  const actor = await authenticateRequest(request);
  if (!actor) return { response: Response.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  try {
    return { scope: await getOrganizationScope(actor.userId) };
  } catch {
    return { response: Response.json({ error: 'FORBIDDEN' }, { status: 403 }) };
  }
}

export function badRequest(error: unknown): Response {
  const message = error instanceof Error ? error.message : '';
  if (message === 'ORGANIZATION_OUT_OF_SCOPE' || message === 'MERCHANT_OUT_OF_SCOPE') {
    return Response.json({ error: 'FORBIDDEN_FILTER' }, { status: 403 });
  }
  if (message === 'INVALID_BUSINESS_SOURCE') {
    return Response.json({ error: 'INVALID_BUSINESS_SOURCE' }, { status: 400 });
  }
  if (message.startsWith('UNKNOWN_METRIC:')) {
    return Response.json({ error: 'UNKNOWN_METRIC' }, { status: 400 });
  }
  if (
    (error instanceof Error && error.name === 'ZodError')
    || message === 'metricIds is required'
    || message.startsWith('Invalid tri-state value:')
    || message === 'Invalid abnormal value'
  ) {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }
  console.error('request_failed', { kind: error instanceof Error ? 'ERROR' : 'NON_ERROR' });
  return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
}
