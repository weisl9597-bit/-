export const selectedSheets = ['项目明细2', '工作表3'] as const;

export const projectColumns = {
  city: ['城市', '装企城市', '你'],
  merchantId: ['装企ID', '商家ID', '商户ID'],
  merchantName: ['装企名称', '商家名称', '装修公司'],
  projectId: ['项目ID', '项目id'],
  businessSource: ['类别'],
  category: ['类别'],
  assignedAt: ['分派时间1', '分派时间'],
  followWithin30m: ['30min内跟进', '30分钟内跟进'],
  needsAnalyzed: ['详细需求沟通/户型解析', '详细需求沟通或户型解析'],
  hardInvite: ['硬约沟通/量房'],
  needsCoaching: ['是否需辅导', '需辅导项目', '是否需辅导装企'],
  coached: ['是否辅导', '城市辅导结果（分公司填写）'],
  improved: [
    '是否改善',
    '改善情况',
    '辅导次日是否在群内有改变（总部检核填写）',
  ],
} as const;

export const organizationColumns = {
  cityType: ['城市类型'],
  city: ['装企城市', '城市'],
  region: ['大区'],
} as const;

export type ProjectField = keyof typeof projectColumns;
export type OrganizationField = keyof typeof organizationColumns;

export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/[（(]/g, '（')
    .replace(/[）)]/g, '）')
    .toLowerCase();
}

