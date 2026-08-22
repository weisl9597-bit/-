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
  return Response.json({
    error: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : String(error),
  }, { status: 400 });
}
