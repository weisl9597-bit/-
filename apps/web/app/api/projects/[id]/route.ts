import { resolveRequestScope } from '../../../../lib/api/request-scope';
import { getProjectDetail } from '../../../../lib/queries/projects';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorization = await resolveRequestScope(request);
  if ('response' in authorization) return authorization.response;
  const { id } = await context.params;
  const project = await getProjectDetail(id, authorization.scope);
  return project
    ? Response.json(project)
    : Response.json({ error: 'NOT_FOUND' }, { status: 404 });
}
