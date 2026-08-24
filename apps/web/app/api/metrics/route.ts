import { badRequest, resolveRequestScope } from '../../../lib/api/request-scope';
import { sourceAwareOperationsEnabled } from '../../../lib/operations-rollout';
import { getMetricCenterDataForRollout } from '../../../lib/queries/metrics';
import { parseMetricRequest } from '../../../lib/queries/request';

export async function GET(request: Request): Promise<Response> {
  const authorization = await resolveRequestScope(request);
  if ('response' in authorization) return authorization.response;
  try {
    const query = parseMetricRequest(new URL(request.url));
    return Response.json(await getMetricCenterDataForRollout(
      sourceAwareOperationsEnabled(), query, authorization.scope,
    ));
  } catch (error) {
    return badRequest(error);
  }
}
