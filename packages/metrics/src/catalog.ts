export type MetricGroupId =
  | 'dispatch_open'
  | 'open_pk'
  | 'conversion'
  | 'designer_sop'
  | 'group_sync'
  | 'chat_quality'
  | 'management';

export const METRIC_FORMULA_VERSION = 'v3' as const;

export type MetricDefinition = {
  id: string;
  name: string;
  groupId: MetricGroupId;
  groupName: string;
  unit: 'COUNT' | 'RATE';
  direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  source: 'CALCULATED';
  sortOrder: number;
  formulaVersion: typeof METRIC_FORMULA_VERSION;
};

const groups: Record<MetricGroupId, string> = {
  dispatch_open: '分派-开口',
  open_pk: '开口-PK',
  conversion: '结果转化',
  designer_sop: '设计师SOP执行',
  group_sync: '群信息同步',
  chat_quality: '群聊质量',
  management: '管理指标',
};

function metric(
  id: string,
  name: string,
  groupId: MetricGroupId,
  unit: MetricDefinition['unit'],
  direction: MetricDefinition['direction'],
  sortOrder: number,
): MetricDefinition {
  return {
    id, name, groupId, groupName: groups[groupId], unit, direction,
    source: 'CALCULATED', sortOrder, formulaVersion: METRIC_FORMULA_VERSION,
  };
}

export const metricCatalog = [
  metric('dispatch_project_count', '分派项目数', 'dispatch_open', 'COUNT', 'NEUTRAL', 1),
  metric('dispatch_assignment_count', '分派次数', 'dispatch_open', 'COUNT', 'NEUTRAL', 2),
  metric('open_project_count', '开口项目数', 'dispatch_open', 'COUNT', 'POSITIVE', 3),
  metric('group_open_count', '开口次数（群）', 'dispatch_open', 'COUNT', 'POSITIVE', 4),
  metric('project_open_rate', '拉群后群内开口率', 'dispatch_open', 'RATE', 'POSITIVE', 5),
  metric('assignment_open_rate', '拉群后群内次数开口率', 'dispatch_open', 'RATE', 'POSITIVE', 6),
  metric('exit_group_project_count', '退群项目数', 'dispatch_open', 'COUNT', 'NEGATIVE', 7),
  metric('exit_group_rate', '分派退群率', 'dispatch_open', 'RATE', 'NEGATIVE', 8),

  metric('online_pk_project_count', '线上PK项目数', 'open_pk', 'COUNT', 'POSITIVE', 9),
  metric('open_to_pk_rate', '拉群开口后线上PK率', 'open_pk', 'RATE', 'POSITIVE', 10),

  metric('handshake_project_count', '量房或到店数（握手）', 'conversion', 'COUNT', 'POSITIVE', 11),
  metric('open_to_handshake_rate', '群内开口后握手率', 'conversion', 'RATE', 'POSITIVE', 12),
  metric('pk_handshake_project_count', 'PK且握手数', 'conversion', 'COUNT', 'POSITIVE', 13),
  metric('pk_handshake_rate', 'PK握手率', 'conversion', 'RATE', 'POSITIVE', 14),
  metric('no_pk_handshake_project_count', '未PK但握手数', 'conversion', 'COUNT', 'NEUTRAL', 15),
  metric('open_to_deep_connection_rate', '拉群开口后深度连接率（线上PK或未PK但握手率）', 'conversion', 'RATE', 'POSITIVE', 16),
  metric('no_pk_handshake_share', '未PK但握手的占比', 'conversion', 'RATE', 'NEUTRAL', 17),
  metric('signed_project_count', '签约项目数', 'conversion', 'COUNT', 'POSITIVE', 18),
  metric('dispatch_signed_rate', '分派签约率', 'conversion', 'RATE', 'POSITIVE', 19),
  metric('open_signed_rate', '开口签约率', 'conversion', 'RATE', 'POSITIVE', 20),
  metric('pk_signed_rate', 'PK签约率', 'conversion', 'RATE', 'POSITIVE', 21),
  metric('handshake_signed_rate', '握手签约率', 'conversion', 'RATE', 'POSITIVE', 22),

  metric('follow_30m_count', '30min内跟进数', 'designer_sop', 'COUNT', 'POSITIVE', 23),
  metric('detailed_needs_count', '详细需求沟通或户型解析数', 'designer_sop', 'COUNT', 'POSITIVE', 24),
  metric('hard_invite_count', '硬约沟通/量房数', 'designer_sop', 'COUNT', 'NEGATIVE', 25),
  metric('follow_30m_execution_rate', '30min内跟进执行率', 'designer_sop', 'RATE', 'POSITIVE', 26),
  metric('detailed_needs_rate', '详细需求沟通或户型解析率', 'designer_sop', 'RATE', 'POSITIVE', 27),
  metric('hard_invite_rate', '硬约沟通/量房率', 'designer_sop', 'RATE', 'NEGATIVE', 28),

  metric('sync_detail_with_plan_count', '有详细需求有户型图', 'group_sync', 'COUNT', 'POSITIVE', 29),
  metric('sync_detail_without_plan_count', '有详细需求无户型图', 'group_sync', 'COUNT', 'NEUTRAL', 30),
  metric('sync_no_detail_with_plan_count', '无详细需求有户型图', 'group_sync', 'COUNT', 'NEUTRAL', 31),
  metric('sync_no_detail_without_plan_count', '无详细需求无户型图', 'group_sync', 'COUNT', 'NEGATIVE', 32),
  metric('sync_detail_with_plan_rate', '有详细需求有户型图占比', 'group_sync', 'RATE', 'POSITIVE', 33),
  metric('sync_no_detail_without_plan_rate', '无详细需求无户型图占比', 'group_sync', 'RATE', 'NEGATIVE', 34),

  metric('quality_good_count', '还不错', 'chat_quality', 'COUNT', 'POSITIVE', 35),
  metric('quality_average_count', '一般', 'chat_quality', 'COUNT', 'NEUTRAL', 36),
  metric('quality_poor_count', '差', 'chat_quality', 'COUNT', 'NEGATIVE', 37),
  metric('quality_poor_coached_count', '差-已辅导', 'chat_quality', 'COUNT', 'NEUTRAL', 38),
  metric('quality_poor_no_anomaly_count', '差-无异常', 'chat_quality', 'COUNT', 'NEUTRAL', 39),
  metric('quality_good_rate', '群聊还不错的占比', 'chat_quality', 'RATE', 'POSITIVE', 40),
] as const satisfies readonly MetricDefinition[];

export const managementMetricCatalog = [
  metric('merchant_sop_compliance_rate', '商家SOP执行达标率', 'management', 'RATE', 'POSITIVE', 41),
] as const satisfies readonly MetricDefinition[];

export const allMetricDefinitions = [
  ...metricCatalog,
  ...managementMetricCatalog,
] as const;

