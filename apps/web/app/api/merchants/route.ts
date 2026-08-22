import { badRequest, resolveRequestScope } from '../../../lib/api/request-scope';
import { listMerchants } from '../../../lib/queries/merchants';
import { parseMerchantRequest } from '../../../lib/queries/request';

export async function GET(request: Request): Promise<Response> {
  const authorization = await resolveRequestScope(request);
  if ('response' in authorization) return authorization.response;
  try {
    return Response.json(await listMerchants(
      parseMerchantRequest(new URL(request.url)), authorization.scope,
    ));
  } catch (error) {
    return badRequest(error);
  }
}
