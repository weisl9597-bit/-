import { describe, expect, it } from 'vitest';

import {
  createMerchantDecisionHandler,
  type MerchantDecisionInput,
} from '../lib/admin/merchant-decision-handler';

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/admin/merchant-decisions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('merchant decision API', () => {
  it('confirms a C candidate and records the actor and reason', async () => {
    let saved: MerchantDecisionInput | null = null;
    const handler = createMerchantDecisionHandler({
      authorize: async () => ({ userId: 'admin-1', role: 'ADMIN' }),
      saveDecision: async (input) => {
        saved = input;
        return { id: 'override-1' };
      },
    }, { now: () => new Date('2026-08-21T08:00:00Z') });

    const response = await handler(request({
      merchantId: 'merchant-1',
      type: 'CONFIRM_C',
      businessSource: 'DESIGNBAO',
      reason: '连续两周指标未改善，确认进入C类',
    }));

    expect(response.status).toBe(201);
    expect(saved).toMatchObject({
      merchantId: 'merchant-1',
      type: 'CONFIRM_C',
      businessSource: 'DESIGNBAO',
      classification: 'C',
      actorId: 'admin-1',
      reason: '连续两周指标未改善，确认进入C类',
      startDate: '2026-08-21',
    });
  });

  it('requires a source for non-global decisions and clears it for permanent exclusion', async () => {
    const saved: MerchantDecisionInput[] = [];
    const handler = createMerchantDecisionHandler({
      authorize: async () => ({ userId: 'admin-1', role: 'ADMIN' }),
      saveDecision: async (input) => { saved.push(input); return { id: 'override-1' }; },
    }, { now: () => new Date('2026-08-21T08:00:00Z') });

    const missing = await handler(request({
      merchantId: 'merchant-1', type: 'TEMP_EXEMPT', endDate: '2026-08-31', reason: '保护期',
    }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: 'BUSINESS_SOURCE_REQUIRED' });

    const global = await handler(request({
      merchantId: 'merchant-1', type: 'PERMANENT_EXCLUDE', businessSource: 'DESIGNBAO', reason: '永久停用',
    }));
    expect(global.status).toBe(201);
    expect(saved[0]).toMatchObject({ type: 'PERMANENT_EXCLUDE', businessSource: null });
  });

  it('requires an end date for a temporary exemption', async () => {
    const handler = createMerchantDecisionHandler({
      authorize: async () => ({ userId: 'admin-1', role: 'ADMIN' }),
      saveDecision: async () => ({ id: 'not-created' }),
    });

    const response = await handler(request({
      merchantId: 'merchant-1', type: 'TEMP_EXEMPT', businessSource: 'DESIGNBAO', reason: '新商家保护期',
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'END_DATE_REQUIRED' });
  });

  it('rejects non-admin actors and blank reasons', async () => {
    const forbidden = createMerchantDecisionHandler({
      authorize: async () => ({ userId: 'city-1', role: 'CITY_MANAGER' }),
      saveDecision: async () => ({ id: 'not-created' }),
    });
    expect((await forbidden(request({ merchantId: 'M1', type: 'CONFIRM_C', businessSource: 'DESIGNBAO', reason: '确认' }))).status)
      .toBe(403);

    const admin = createMerchantDecisionHandler({
      authorize: async () => ({ userId: 'admin-1', role: 'ADMIN' }),
      saveDecision: async () => ({ id: 'not-created' }),
    });
    expect((await admin(request({ merchantId: 'M1', type: 'CONFIRM_C', businessSource: 'DESIGNBAO', reason: ' ' }))).status)
      .toBe(400);
  });
});

