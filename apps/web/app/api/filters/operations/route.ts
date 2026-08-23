import { resolveRequestScope } from '../../../../lib/api/request-scope';
import { sourceAwareOperationsEnabled } from '../../../../lib/operations-rollout';
import { getMetricFilterOptions } from '../../../../lib/queries/metric-filters';
import {
  getOperationsFilterOptions,
  parseOperationsFilter,
} from '../../../../lib/queries/operations-filters';
import { getBusinessSourceRebuildStatus } from '../../../../lib/queries/rebuild-status';

export async function GET(request: Request): Promise<Response> {
  const authorization = await resolveRequestScope(request);
  if ('response' in authorization) return authorization.response;
  let source: 'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL';
  try {
    source = parseOperationsFilter(new URL(request.url)).source;
  } catch {
    return Response.json({ error: 'INVALID_BUSINESS_SOURCE' }, { status: 400 });
  }
  const enabled = sourceAwareOperationsEnabled();
  const [options, rebuildStatus] = await Promise.all([
    enabled
      ? getOperationsFilterOptions(source, authorization.scope)
      : getMetricFilterOptions(authorization.scope),
    getBusinessSourceRebuildStatus(),
  ]);
  return Response.json({ enabled, ...options, rebuildStatus });
}

