import { resolveRequestScope } from '../../../../lib/api/request-scope';
import { getMetricFilterOptions } from '../../../../lib/queries/metric-filters';

export async function GET(request: Request): Promise<Response> {
  const authorization = await resolveRequestScope(request);
  if ('response' in authorization) return authorization.response;
  return Response.json(await getMetricFilterOptions(authorization.scope));
}
