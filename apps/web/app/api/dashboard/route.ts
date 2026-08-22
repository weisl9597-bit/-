import { badRequest, resolveRequestScope } from '../../../lib/api/request-scope';
import { getDashboard } from '../../../lib/queries/dashboard';

export async function GET(request: Request): Promise<Response> {
  const authorization = await resolveRequestScope(request);
  if ('response' in authorization) return authorization.response;
  try {
    return Response.json(await getDashboard(authorization.scope));
  } catch (error) {
    return badRequest(error);
  }
}
