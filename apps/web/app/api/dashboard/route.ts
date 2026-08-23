import { badRequest, resolveRequestScope } from '../../../lib/api/request-scope';
import { sourceAwareOperationsEnabled } from '../../../lib/operations-rollout';
import { getDashboardForRollout } from '../../../lib/queries/dashboard';
import { parseOperationsFilter } from '../../../lib/queries/operations-filters';

export async function GET(request: Request): Promise<Response> {
  const authorization = await resolveRequestScope(request);
  if ('response' in authorization) return authorization.response;
  try {
    const filter = parseOperationsFilter(new URL(request.url));
    return Response.json(await getDashboardForRollout(
      sourceAwareOperationsEnabled(), filter, authorization.scope,
    ));
  } catch (error) {
    return badRequest(error);
  }
}

