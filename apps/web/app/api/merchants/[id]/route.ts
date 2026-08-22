import { resolveRequestScope } from '../../../../lib/api/request-scope';
import { getMerchantDetail } from '../../../../lib/queries/merchants';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorization = await resolveRequestScope(request);
  if ('response' in authorization) return authorization.response;
  const { id } = await context.params;
  const merchant = await getMerchantDetail(id, authorization.scope);
  return merchant
    ? Response.json(merchant)
    : Response.json({ error: 'NOT_FOUND' }, { status: 404 });
}
