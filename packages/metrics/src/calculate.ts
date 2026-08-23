import type { MetricDefinition } from './catalog';

export type MetricRow = {
  rowId?: string;
  assignmentId: string;
  sourceProjectId: string;
  organizationIds: string[];
  merchantId: string;
  dataDate: string;
  projectDate?: string | null;
  assignmentDate?: string | null;
  signedDate?: string | null;
  assignmentCount?: number;
  businessSource?: 'DESIGNBAO' | 'XIAOHONGSHU' | 'OTHER';
  followWithin30m: boolean | null;
  needsAnalyzed: boolean | null;
  hardInvite: boolean | null;
  needsCoaching?: boolean | null;
  coached: boolean | null;
  improved?: boolean | null;
  raw: Record<string, unknown>;
};

export type MetricResult = {
  value: number | null;
  numerator: number | null;
  denominator: number | null;
};

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function rate(numerator: number, denominator: number): MetricResult {
  return {
    value: denominator === 0 ? null : rounded((numerator / denominator) * 100),
    numerator,
    denominator,
  };
}

function count(value: number): MetricResult {
  return { value, numerator: value, denominator: null };
}

function token(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function yes(value: unknown): boolean {
  return value === true || ['是', '有', '已完成', '完成', '已签约', '1', 'true'].includes(token(value));
}

function signed(value: unknown): boolean {
  return ['是', '已收定'].includes(token(value));
}

type ProjectFact = {
  rows: MetricRow[];
  open: boolean;
  exited: boolean;
  pk: boolean;
  handshake: boolean;
  signed: boolean;
  sync: string;
};

function projectFacts(rows: MetricRow[]): ProjectFact[] {
  const grouped = new Map<string, MetricRow[]>();
  for (const row of rows) {
    const key = row.rowId ?? row.sourceProjectId;
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }
  return [...grouped.values()].map((values) => ({
    rows: values,
    open: values.some((row) => yes(row.raw.U)),
    exited: values.some((row) => yes(row.raw.AB)),
    pk: values.some((row) => yes(row.raw.AH)),
    handshake: values.some((row) => yes(row.raw.AI)),
    signed: values.some((row) => signed(row.raw.AJ)),
    sync: values.map((row) => token(row.raw.S)).find(Boolean) ?? '',
  }));
}

function qualityCount(rows: MetricRow[], quality: string): number {
  return rows.filter((row) => token(row.raw.V) === quality).length;
}

function rowsOn(
  rows: readonly MetricRow[],
  periodDate: string | undefined,
  field: 'projectDate' | 'assignmentDate' | 'signedDate',
): MetricRow[] {
  if (!periodDate) return [...rows];
  return rows.filter((row) => {
    const fallback = field === 'signedDate' ? null : row.dataDate;
    return (row[field] === undefined ? fallback : row[field]) === periodDate;
  });
}

export function calculateMetric(
  definition: MetricDefinition,
  rows: readonly MetricRow[],
  periodDate?: string,
): MetricResult {
  const projectRows = rowsOn(rows, periodDate, 'projectDate');
  const assignmentRows = rowsOn(rows, periodDate, 'assignmentDate');
  const signedRows = rowsOn(rows, periodDate, 'signedDate');
  const projects = projectFacts(projectRows);
  const dispatchProjects = projects.length;
  const dispatchAssignments = projectRows.reduce(
    (sum, row) => sum + (Number.isFinite(row.assignmentCount) ? row.assignmentCount! : 1),
    0,
  );
  const openProjects = projects.filter((project) => project.open).length;
  const groupOpen = assignmentRows.filter((row) => yes(row.raw.T)).length;
  const exited = projects.filter((project) => project.exited).length;
  const pk = projects.filter((project) => project.pk).length;
  const handshake = projects.filter((project) => project.handshake).length;
  const pkHandshake = projects.filter((project) => project.pk && project.handshake).length;
  const noPkHandshake = projects.filter((project) => !project.pk && project.handshake).length;
  const deepConnection = projects.filter((project) => project.pk || (!project.pk && project.handshake)).length;
  const signedProjects = projectFacts(signedRows).filter((project) => project.signed).length;
  const follow = assignmentRows.filter((row) => row.followWithin30m === true).length;
  const detailed = assignmentRows.filter((row) => row.needsAnalyzed === true).length;
  const hardInvite = assignmentRows.filter((row) => row.hardInvite === true).length;
  const compliant = assignmentRows.filter((row) =>
    row.followWithin30m === true && row.needsAnalyzed === true && row.hardInvite === false,
  ).length;
  const syncCount = (value: string) => projects.filter((project) => project.sync === value).length;
  const good = qualityCount(assignmentRows, '还不错');
  const average = qualityCount(assignmentRows, '一般');
  const poor = qualityCount(assignmentRows, '差');

  switch (definition.id) {
    case 'dispatch_project_count': return count(dispatchProjects);
    case 'dispatch_assignment_count': return count(dispatchAssignments);
    case 'open_project_count': return count(openProjects);
    case 'group_open_count': return count(groupOpen);
    case 'project_open_rate': return rate(openProjects, dispatchProjects);
    case 'assignment_open_rate': return rate(groupOpen, dispatchAssignments);
    case 'exit_group_project_count': return count(exited);
    case 'exit_group_rate': return rate(exited, dispatchProjects);
    case 'online_pk_project_count': return count(pk);
    case 'open_to_pk_rate': return rate(pk, openProjects);
    case 'handshake_project_count': return count(handshake);
    case 'open_to_handshake_rate': return rate(handshake, openProjects);
    case 'pk_handshake_project_count': return count(pkHandshake);
    case 'pk_handshake_rate': return rate(pkHandshake, pk);
    case 'no_pk_handshake_project_count': return count(noPkHandshake);
    case 'open_to_deep_connection_rate': return rate(deepConnection, openProjects);
    case 'no_pk_handshake_share': return rate(noPkHandshake, handshake);
    case 'signed_project_count': return count(signedProjects);
    case 'dispatch_signed_rate': return rate(signedProjects, dispatchProjects);
    case 'open_signed_rate': return rate(signedProjects, openProjects);
    case 'pk_signed_rate': return rate(signedProjects, pk);
    case 'handshake_signed_rate': return rate(signedProjects, handshake);
    case 'follow_30m_count': return count(follow);
    case 'detailed_needs_count': return count(detailed);
    case 'hard_invite_count': return count(hardInvite);
    case 'follow_30m_execution_rate': return rate(follow, dispatchAssignments);
    case 'detailed_needs_rate': return rate(detailed, dispatchAssignments);
    case 'hard_invite_rate': return rate(hardInvite, dispatchAssignments);
    case 'sync_detail_with_plan_count': return count(syncCount('有详细需求有户型图'));
    case 'sync_detail_without_plan_count': return count(syncCount('有详细需求无户型图'));
    case 'sync_no_detail_with_plan_count': return count(syncCount('无详细需求有户型图'));
    case 'sync_no_detail_without_plan_count': return count(syncCount('无详细需求无户型图'));
    case 'sync_detail_with_plan_rate': return rate(syncCount('有详细需求有户型图'), dispatchProjects);
    case 'sync_no_detail_without_plan_rate': return rate(syncCount('无详细需求无户型图'), dispatchProjects);
    case 'quality_good_count': return count(good);
    case 'quality_average_count': return count(average);
    case 'quality_poor_count': return count(poor);
    case 'quality_poor_coached_count':
      return count(assignmentRows.filter((row) => token(row.raw.V) === '差' && token(row.raw.Y) === '已辅导').length);
    case 'quality_poor_no_anomaly_count':
      return count(assignmentRows.filter((row) => token(row.raw.V) === '差' && token(row.raw.Y) === '无异常').length);
    case 'quality_good_rate': return rate(good, groupOpen);
    case 'merchant_sop_compliance_rate': return rate(compliant, dispatchAssignments);
    default: throw new Error(`未实现指标公式：${definition.id}`);
  }
}
