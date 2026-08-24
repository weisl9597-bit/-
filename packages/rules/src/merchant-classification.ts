import type { SelectableBusinessSource } from '@designbao/domain/business-source';
import { percentage } from './reasons';

export type MerchantClassification =
  | 'A'
  | 'A_RISK'
  | 'B'
  | 'C_CANDIDATE'
  | 'C'
  | 'ELIMINATED';

export type MerchantClassificationInput = {
  merchantId: string;
  businessSource: SelectableBusinessSource;
  dataAvailable: boolean;
  dataDate: string;
  sopRate: number | null;
  signedThisMonth: boolean;
  weeklySopRates: number[];
  processMetric: number | null;
  cityProcessAverage: number | null;
  currentClassification: MerchantClassification | null;
  manualClassification?: MerchantClassification | null;
  classificationSince: string | null;
  lastAssignedAt: string | null;
  cConfirmed: boolean;
  temporaryExemptUntil: string | null;
  permanentlyExcluded: boolean;
};

export type ClassificationDecision = {
  merchantId: string;
  businessSource: SelectableBusinessSource;
  dataAvailable: boolean;
  suggested: MerchantClassification | null;
  requiresConfirmation: boolean;
  ruleVersion: 'v2';
  evidence: Array<{ metricId: string; value: number | boolean | null; comparison?: number }>;
  reason: string;
};

function dayDifference(later: string, earlier: string | null): number {
  if (!earlier) return 0;
  const milliseconds = Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 86_400_000) : 0;
}

function isDeclining(values: number[]): boolean {
  return values.length >= 3 && values.at(-3)! > values.at(-2)! && values.at(-2)! > values.at(-1)!;
}

function decision(
  input: MerchantClassificationInput,
  suggested: MerchantClassification,
  reason: string,
  requiresConfirmation = false,
): ClassificationDecision {
  return {
    merchantId: input.merchantId,
    businessSource: input.businessSource,
    dataAvailable: input.dataAvailable,
    suggested,
    requiresConfirmation,
    ruleVersion: 'v2',
    evidence: [
      { metricId: 'merchant_sop_compliance_rate', value: input.sopRate },
      { metricId: 'signed_this_month', value: input.signedThisMonth },
      { metricId: 'process_metric', value: input.processMetric, comparison: input.cityProcessAverage ?? undefined },
    ],
    reason,
  };
}

export function classifyMerchant(input: MerchantClassificationInput): ClassificationDecision {
  if (!input.dataAvailable) {
    return {
      merchantId: input.merchantId,
      businessSource: input.businessSource,
      dataAvailable: false,
      suggested: null,
      requiresConfirmation: false,
      ruleVersion: 'v2',
      evidence: [],
      reason: '该来源暂无数据',
    };
  }

  if (input.manualClassification) {
    return decision(
      input,
      input.manualClassification,
      '人工分类生效中，自动规则仅更新证据，不覆盖人工结论。',
    );
  }

  if (input.permanentlyExcluded) {
    return decision(
      input,
      input.currentClassification ?? 'A_RISK',
      '商家处于永久排除状态，系统保留当前分类且不执行自动生命周期判断。',
    );
  }

  if (input.lastAssignedAt && dayDifference(input.dataDate, input.lastAssignedAt) >= 14) {
    return decision(input, 'ELIMINATED', '距最后一次项目分派已满14天且无新增分派，进入已淘汰。');
  }

  if (input.cConfirmed && ['C_CANDIDATE', 'C'].includes(input.currentClassification ?? '')) {
    return decision(input, 'C', 'C类候选已人工确认，进入14天挽回观察期。');
  }

  const exempt = input.temporaryExemptUntil !== null && input.temporaryExemptUntil >= input.dataDate;
  const aQualified = (input.sopRate ?? -1) >= 60 && input.signedThisMonth;
  if (exempt) {
    return aQualified
      ? decision(input, 'A', '临时豁免期内跳过B/C判断；当前满足A类条件。')
      : decision(input, 'A_RISK', '临时豁免期内跳过B/C判断；当前未满足A类条件，仅作风险提示。');
  }

  const bObservedFor14Days = input.currentClassification === 'B'
    && dayDifference(input.dataDate, input.classificationSince) >= 14;
  const persistentlyBelow40 = input.weeklySopRates.length >= 2
    && input.weeklySopRates.slice(-2).every((value) => value < 40);
  if ((bObservedFor14Days && (input.sopRate ?? 100) < 60) || persistentlyBelow40) {
    return decision(
      input,
      'C_CANDIDATE',
      `SOP达标率${percentage(input.sopRate)}，B类观察期满仍未改善或连续低于40%，需人工确认。`,
      true,
    );
  }

  const bQualified = input.sopRate !== null
    && input.sopRate >= 40
    && input.sopRate < 60
    && isDeclining(input.weeklySopRates)
    && input.processMetric !== null
    && input.cityProcessAverage !== null
    && input.processMetric < input.cityProcessAverage;
  if (bQualified) {
    return decision(
      input,
      'B',
      `SOP达标率${percentage(input.sopRate)}且连续两周下降，过程指标低于城市平均，进入14天观察。`,
    );
  }

  if (aQualified) {
    return decision(input, 'A', `SOP达标率${percentage(input.sopRate)}且当月已有签约项目。`);
  }
  return decision(input, 'A_RISK', `SOP达标率${percentage(input.sopRate)}或当月签约未满足A类条件。`);
}
