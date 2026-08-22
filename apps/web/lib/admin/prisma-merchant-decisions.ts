import { db } from '@designbao/db/client';
import { authenticateRequest } from '../auth/request-actor';
import type { MerchantDecisionDependencies, MerchantDecisionInput } from './merchant-decision-handler';

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

async function saveDecision(input: MerchantDecisionInput) {
  return db.$transaction(async (transaction) => {
    const merchant = await transaction.merchant.findUnique({
      where: { id: input.merchantId },
      select: { id: true },
    });
    if (!merchant) throw new Error('MERCHANT_NOT_FOUND');

    const current = await transaction.merchantClassificationSnapshot.findFirst({
      where: { merchantId: input.merchantId },
      orderBy: [{ dataDate: 'desc' }, { createdAt: 'desc' }],
    });
    const created = await transaction.merchantOverride.create({
      data: {
        merchantId: input.merchantId,
        type: input.type,
        classification: input.classification,
        startDate: dateOnly(input.startDate),
        endDate: input.endDate ? dateOnly(input.endDate) : null,
        reason: input.reason,
        createdById: input.actorId,
      },
    });

    if (input.type === 'CONFIRM_C' && current?.requiresConfirmation) {
      await transaction.merchantClassificationSnapshot.update({
        where: { id: current.id },
        data: {
          classification: 'C',
          requiresConfirmation: false,
          confirmedById: input.actorId,
          effectiveAt: new Date(),
        },
      });
    }

    await transaction.auditLog.create({
      data: {
        actorId: input.actorId,
        action: `MERCHANT_OVERRIDE_${input.type}`,
        entityType: 'MERCHANT',
        entityId: input.merchantId,
        reason: input.reason,
        beforeValue: current ? {
          classification: current.classification,
          requiresConfirmation: current.requiresConfirmation,
        } : undefined,
        afterValue: {
          overrideId: created.id,
          type: input.type,
          classification: input.classification,
          startDate: input.startDate,
          endDate: input.endDate,
        },
      },
    });
    return { id: created.id };
  });
}

export const prismaMerchantDecisionDependencies: MerchantDecisionDependencies = {
  authorize: authenticateRequest,
  saveDecision,
};

export async function listMerchantDecisionCandidates() {
  const latestDate = await db.merchantClassificationSnapshot.aggregate({ _max: { dataDate: true } });
  if (!latestDate._max.dataDate) return [];
  return db.merchantClassificationSnapshot.findMany({
    where: { dataDate: latestDate._max.dataDate, requiresConfirmation: true },
    orderBy: [{ classification: 'asc' }, { merchantId: 'asc' }],
    include: { merchant: { select: { name: true } } },
  });
}

