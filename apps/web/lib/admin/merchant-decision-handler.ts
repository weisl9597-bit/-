export type DecisionActor = {
  userId: string;
  role: 'ADMIN' | 'REGION_MANAGER' | 'CITY_MANAGER';
};

export type MerchantDecisionType =
  | 'CONFIRM_C'
  | 'TEMP_EXEMPT'
  | 'PERMANENT_EXCLUDE'
  | 'MANUAL_CLASSIFICATION';

export type DecisionClassification = 'A' | 'A_RISK' | 'B' | 'C_CANDIDATE' | 'C' | 'ELIMINATED';

export type MerchantDecisionInput = {
  merchantId: string;
  businessSource: SelectableBusinessSource | null;
  type: MerchantDecisionType;
  classification: DecisionClassification | null;
  startDate: string;
  endDate: string | null;
  reason: string;
  actorId: string;
};

export type MerchantDecisionDependencies = {
  authorize(request: Request): Promise<DecisionActor | null>;
  saveDecision(input: MerchantDecisionInput): Promise<{ id: string }>;
};

const types = new Set<MerchantDecisionType>([
  'CONFIRM_C', 'TEMP_EXEMPT', 'PERMANENT_EXCLUDE', 'MANUAL_CLASSIFICATION',
]);
const classifications = new Set<DecisionClassification>([
  'A', 'A_RISK', 'B', 'C_CANDIDATE', 'C', 'ELIMINATED',
]);
const businessSources = new Set<SelectableBusinessSource>(['DESIGNBAO', 'XIAOHONGSHU', 'ALL']);

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

export function createMerchantDecisionHandler(
  dependencies: MerchantDecisionDependencies,
  options: { now(): Date } = { now: () => new Date() },
) {
  return async function postMerchantDecision(request: Request): Promise<Response> {
    const actor = await dependencies.authorize(request);
    if (!actor) return jsonError('UNAUTHORIZED', 401);
    if (actor.role !== 'ADMIN') return jsonError('FORBIDDEN', 403);

    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return jsonError('INVALID_JSON', 400);
    }

    const merchantId = typeof body.merchantId === 'string' ? body.merchantId.trim() : '';
    const type = typeof body.type === 'string' && types.has(body.type as MerchantDecisionType)
      ? body.type as MerchantDecisionType
      : null;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!merchantId) return jsonError('MERCHANT_REQUIRED', 400);
    if (!type) return jsonError('INVALID_DECISION_TYPE', 400);
    if (!reason) return jsonError('REASON_REQUIRED', 400);

    const businessSource = type === 'PERMANENT_EXCLUDE'
      ? null
      : typeof body.businessSource === 'string'
        && businessSources.has(body.businessSource as SelectableBusinessSource)
        ? body.businessSource as SelectableBusinessSource
        : null;
    if (type !== 'PERMANENT_EXCLUDE' && !businessSource) {
      return jsonError('BUSINESS_SOURCE_REQUIRED', 400);
    }

    const startDate = body.startDate === undefined
      ? options.now().toISOString().slice(0, 10)
      : dateOnly(body.startDate);
    if (!startDate) return jsonError('INVALID_START_DATE', 400);
    const endDate = body.endDate ? dateOnly(body.endDate) : null;
    if (body.endDate && !endDate) return jsonError('INVALID_END_DATE', 400);
    if (type === 'TEMP_EXEMPT' && !endDate) return jsonError('END_DATE_REQUIRED', 400);
    if (endDate && endDate < startDate) return jsonError('END_DATE_BEFORE_START', 400);

    let classification: DecisionClassification | null = null;
    if (type === 'CONFIRM_C') classification = 'C';
    if (type === 'PERMANENT_EXCLUDE') classification = 'ELIMINATED';
    if (type === 'MANUAL_CLASSIFICATION') {
      classification = typeof body.classification === 'string'
        && classifications.has(body.classification as DecisionClassification)
        ? body.classification as DecisionClassification
        : null;
      if (!classification) return jsonError('CLASSIFICATION_REQUIRED', 400);
    }

    try {
      const saved = await dependencies.saveDecision({
        merchantId, businessSource, type, classification, startDate, endDate, reason, actorId: actor.userId,
      });
      return Response.json({ id: saved.id, status: 'SAVED' }, { status: 201 });
    } catch (error) {
      if (error instanceof Error && error.message === 'MERCHANT_NOT_FOUND') {
        return jsonError('MERCHANT_NOT_FOUND', 404);
      }
      return jsonError('SAVE_FAILED', 500);
    }
  };
}
import type { SelectableBusinessSource } from '@designbao/domain/business-source';


