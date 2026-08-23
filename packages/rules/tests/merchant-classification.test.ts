import { describe, expect, it } from 'vitest';
import { classifyMerchant, type MerchantClassificationInput } from '../src/merchant-classification';

function input(overrides: Partial<MerchantClassificationInput> = {}): MerchantClassificationInput {
  return {
    merchantId: 'M1', businessSource: 'DESIGNBAO', dataAvailable: true,
    dataDate: '2026-08-21', sopRate: 70,
    signedThisMonth: true, weeklySopRates: [62, 66, 70],
    processMetric: 65, cityProcessAverage: 60,
    currentClassification: 'A', classificationSince: '2026-08-01',
    lastAssignedAt: '2026-08-20', cConfirmed: false,
    temporaryExemptUntil: null, permanentlyExcluded: false,
    ...overrides,
  };
}

describe('merchant classification', () => {
  it('classifies a compliant and signed merchant as A', () => {
    expect(classifyMerchant(input())).toMatchObject({
      businessSource: 'DESIGNBAO', dataAvailable: true, suggested: 'A',
      requiresConfirmation: false, ruleVersion: 'v2',
    });
  });

  it('preserves a source row with no data instead of inventing a classification', () => {
    expect(classifyMerchant(input({
      businessSource: 'XIAOHONGSHU', dataAvailable: false,
    }))).toEqual({
      merchantId: 'M1', businessSource: 'XIAOHONGSHU', dataAvailable: false,
      suggested: null, requiresConfirmation: false, ruleVersion: 'v2',
      evidence: [], reason: '该来源暂无数据',
    });
  });

  it('flags an A merchant when SOP or monthly signing is insufficient', () => {
    expect(classifyMerchant(input({ sopRate: 58, signedThisMonth: false, weeklySopRates: [58] })))
      .toMatchObject({ suggested: 'A_RISK' });
  });

  it('suggests B after two weekly declines and below-city process performance', () => {
    expect(classifyMerchant(input({
      sopRate: 50, weeklySopRates: [58, 54, 50], processMetric: 40, cityProcessAverage: 55,
    }))).toMatchObject({ suggested: 'B', requiresConfirmation: false });
  });

  it('suggests C with confirmation after a B merchant remains unimproved for 14 days', () => {
    expect(classifyMerchant(input({
      sopRate: 35, weeklySopRates: [38, 36, 35], currentClassification: 'B',
      classificationSince: '2026-08-01', processMetric: 30, cityProcessAverage: 55,
    }))).toMatchObject({ suggested: 'C_CANDIDATE', requiresConfirmation: true });
  });

  it('keeps a confirmed C decision as C', () => {
    expect(classifyMerchant(input({
      sopRate: 35, currentClassification: 'C_CANDIDATE', cConfirmed: true,
    }))).toMatchObject({ suggested: 'C', requiresConfirmation: false });
  });

  it('gives lifecycle elimination priority after 14 days without assignment', () => {
    expect(classifyMerchant(input({
      sopRate: 80, signedThisMonth: true, lastAssignedAt: '2026-08-07', cConfirmed: true,
    }))).toMatchObject({ suggested: 'ELIMINATED', requiresConfirmation: false });
  });

  it('honors an active temporary exemption for B and C rules', () => {
    expect(classifyMerchant(input({
      sopRate: 30, weeklySopRates: [45, 38, 30], processMetric: 20,
      temporaryExemptUntil: '2026-08-31', currentClassification: 'A',
    }))).toMatchObject({ suggested: 'A_RISK', requiresConfirmation: false });
  });
});

