import { authenticateRequest } from '../../../../lib/auth/request-actor';
import { createMerchantDecisionHandler } from '../../../../lib/admin/merchant-decision-handler';
import {
  listMerchantDecisionCandidates,
  prismaMerchantDecisionDependencies,
} from '../../../../lib/admin/prisma-merchant-decisions';

export const runtime = 'nodejs';

export const POST = createMerchantDecisionHandler(prismaMerchantDecisionDependencies);

export async function GET(request: Request) {
  const actor = await authenticateRequest(request);
  if (!actor) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (actor.role !== 'ADMIN') return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  const requestedSource = new URL(request.url).searchParams.get('source') ?? 'DESIGNBAO';
  const source = ['DESIGNBAO', 'XIAOHONGSHU', 'ALL'].includes(requestedSource)
    ? requestedSource as 'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL'
    : 'DESIGNBAO';
  const items = await listMerchantDecisionCandidates(source);
  return Response.json({ items });
}

