import { badRequest, resolveRequestScope } from '../../../../lib/api/request-scope';
import { sourceAwareOperationsEnabled } from '../../../../lib/operations-rollout';
import { getLegacyMerchantDetail, getMerchantDetail } from '../../../../lib/queries/merchants';
import { parseOperationsFilter } from '../../../../lib/queries/operations-filters';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorization = await resolveRequestScope(request);
  if ('response' in authorization) return authorization.response;
  try {
    const { id } = await context.params;
    const merchant = sourceAwareOperationsEnabled()
      ? await getMerchantDetail(
        id, parseOperationsFilter(new URL(request.url)), authorization.scope,
      )
      : await getLegacyMerchantDetail(id, authorization.scope);
    return merchant
      ? Response.json(merchant)
      : Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  } catch (error) {
    return badRequest(error);
  }
}

