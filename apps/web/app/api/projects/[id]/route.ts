import { badRequest, resolveRequestScope } from '../../../../lib/api/request-scope';
import { sourceAwareOperationsEnabled } from '../../../../lib/operations-rollout';
import { parseOperationsFilter } from '../../../../lib/queries/operations-filters';
import { getLegacyProjectDetail, getProjectDetail } from '../../../../lib/queries/projects';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorization = await resolveRequestScope(request);
  if ('response' in authorization) return authorization.response;
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const project = sourceAwareOperationsEnabled()
      ? await getProjectDetail(
        id, parseOperationsFilter(url), authorization.scope,
        url.searchParams.get('dataDate') ?? undefined,
      )
      : await getLegacyProjectDetail(id, authorization.scope);
    return project
      ? Response.json(project)
      : Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  } catch (error) {
    return badRequest(error);
  }
}

