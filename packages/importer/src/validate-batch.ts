import {
  normalizeBusinessSource,
  type ActualBusinessSource,
} from '@designbao/domain/business-source';

import type {
  ParsedProjectRow,
  ParsedWorkbook,
  WorkbookCellValue,
} from './parse-workbook';

export type ImportIssueCode =
  | 'MISSING_ID'
  | 'DUPLICATE_PROJECT_ID'
  | 'INVALID_DATE'
  | 'UNKNOWN_ORGANIZATION'
  | 'INVALID_ENUM'
  | 'OPTIONAL_VALUE_MISSING'
  | 'SUMMARY_MISMATCH';

export type ImportIssue = {
  code: ImportIssueCode;
  severity: 'ERROR' | 'WARNING';
  sourceSheet: string;
  sourceRow: number;
  field: string;
  message: string;
  rawValue: WorkbookCellValue;
};

export type CanonicalProjectRow = {
  sourceSheet: '项目明细2';
  sourceRow: number;
  city: string;
  cityType: string | null;
  region: string;
  merchantId: string;
  merchantName: string | null;
  assignmentId: string;
  projectId: string;
  businessSource: ActualBusinessSource;
  category: string | null;
  assignedAt: string;
  followWithin30m: boolean | null;
  needsAnalyzed: boolean | null;
  hardInvite: boolean | null;
  needsCoaching: boolean | null;
  coached: boolean | null;
  improved: boolean | null;
  raw: Record<string, WorkbookCellValue>;
};

export type BatchValidationResult = {
  records: CanonicalProjectRow[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
};

type OrganizationMapping = {
  region: string;
  cityType: string | null;
  ambiguousRegion: boolean;
};

function clean(value: WorkbookCellValue): string {
  return String(value ?? '').trim();
}

function issue(
  row: ParsedProjectRow,
  code: ImportIssueCode,
  severity: ImportIssue['severity'],
  field: string,
  message: string,
  rawValue: WorkbookCellValue,
): ImportIssue {
  return {
    code,
    severity,
    sourceSheet: row.sourceSheet,
    sourceRow: row.sourceRow,
    field,
    message,
    rawValue,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dateFromSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const milliseconds = Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000);
  const date = new Date(milliseconds);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function dateFromDate(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function dateFromString(value: string): string | null {
  const trimmed = value.trim();
  const match = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\s.*)?$/.exec(trimmed);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

function normalizeDate(value: WorkbookCellValue): string | null {
  if (typeof value === 'number') return dateFromSerial(value);
  if (value instanceof Date) return dateFromDate(value);
  return typeof value === 'string' ? dateFromString(value) : null;
}

function normalizeBoolean(
  row: ParsedProjectRow,
  field: keyof Pick<
    CanonicalProjectRow,
    | 'followWithin30m'
    | 'needsAnalyzed'
    | 'hardInvite'
    | 'needsCoaching'
    | 'coached'
    | 'improved'
  >,
  value: WorkbookCellValue,
  errors: ImportIssue[],
  warnings: ImportIssue[],
): boolean | null {
  const token = clean(value);
  if (!token) return null;

  const mappings: Record<string, Record<string, boolean>> = {
    needsCoaching: { 需辅导: true, 无需辅导: false, 是: true, 否: false },
    coached: { 已辅导: true, 未辅导: false, 是: true, 否: false },
  };
  const mapped = (mappings[field] ?? { 是: true, 否: false })[token];
  if (mapped !== undefined) return mapped;

  if (['followWithin30m', 'needsAnalyzed', 'hardInvite'].includes(field)) {
    warnings.push(
      issue(
        row,
        'OPTIONAL_VALUE_MISSING',
        'WARNING',
        field,
        '该字段是业务备注而非“是/否”，系统保留为空白并保留原值。',
        value,
      ),
    );
    return null;
  }

  errors.push(
    issue(
      row,
      'INVALID_ENUM',
      'ERROR',
      field,
      `字段值“${token}”不在允许范围内。`,
      value,
    ),
  );
  return null;
}

function buildOrganizationMappings(parsed: ParsedWorkbook): Map<string, OrganizationMapping> {
  const grouped = new Map<string, Array<{ region: string; cityType: string }>>();
  for (const row of parsed.organizations) {
    const city = row.city.trim();
    const region = row.region.trim();
    if (!city || !region) continue;
    const entries = grouped.get(city) ?? [];
    entries.push({ region, cityType: row.cityType.trim() });
    grouped.set(city, entries);
  }
  return new Map(
    [...grouped].map(([city, entries]) => {
      const regions = new Set(entries.map((entry) => entry.region));
      const first = entries[0];
      return [
        city,
        {
          region: first?.region ?? '',
          cityType: first?.cityType || null,
          ambiguousRegion: regions.size > 1,
        },
      ];
    }),
  );
}

export function validateBatch(parsed: ParsedWorkbook): BatchValidationResult {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const records: CanonicalProjectRow[] = [];
  const organizations = buildOrganizationMappings(parsed);
  const assignmentCounts = new Map<string, number>();

  for (const row of parsed.projects) {
    const projectId = clean(row.projectId);
    const merchantId = clean(row.merchantId);
    if (projectId && merchantId) {
      const assignmentId = `${projectId}::${merchantId}`;
      assignmentCounts.set(assignmentId, (assignmentCounts.get(assignmentId) ?? 0) + 1);
    }
  }

  for (const row of parsed.projects) {
    const rowErrorStart = errors.length;
    let rowSkipped = false;
    const city = clean(row.city);
    const merchantId = clean(row.merchantId);
    const projectId = clean(row.projectId);
    const assignmentId = projectId && merchantId ? `${projectId}::${merchantId}` : '';
    const organization = organizations.get(city);

    if (!merchantId) {
      warnings.push(issue(
        row,
        'MISSING_ID',
        'WARNING',
        'merchantId',
        '装企 ID 不能为空，该行已跳过。',
        row.merchantId,
      ));
      rowSkipped = true;
    }
    if (!projectId) {
      warnings.push(issue(
        row,
        'MISSING_ID',
        'WARNING',
        'projectId',
        '项目 ID 不能为空，该行已跳过。',
        row.projectId,
      ));
      rowSkipped = true;
    } else if (merchantId && (assignmentCounts.get(assignmentId) ?? 0) > 1) {
      errors.push(
        issue(
          row,
          'DUPLICATE_PROJECT_ID',
          'ERROR',
          'assignmentId',
          '同一批次中“项目 ID + 装企 ID”重复。',
          assignmentId,
        ),
      );
    }

    if (!city || !organization || organization.ambiguousRegion) {
      warnings.push(
        issue(
          row,
          'UNKNOWN_ORGANIZATION',
          'WARNING',
          'city',
          organization?.ambiguousRegion
            ? '该城市在工作表3中对应多个大区，该行已跳过。'
            : '该城市未在工作表3中找到大区映射，该行已跳过。',
          row.city,
        ),
      );
      rowSkipped = true;
    }

    if (rowSkipped) continue;

    const assignedAt = normalizeDate(row.assignedAt);
    if (!assignedAt) {
      errors.push(issue(row, 'INVALID_DATE', 'ERROR', 'assignedAt', '分派时间无法识别为有效日期。', row.assignedAt));
    }

    const followWithin30m = normalizeBoolean(
      row, 'followWithin30m', row.followWithin30m, errors, warnings,
    );
    const needsAnalyzed = normalizeBoolean(
      row, 'needsAnalyzed', row.needsAnalyzed, errors, warnings,
    );
    const hardInvite = normalizeBoolean(
      row, 'hardInvite', row.hardInvite, errors, warnings,
    );
    const needsCoaching = normalizeBoolean(
      row, 'needsCoaching', row.needsCoaching, errors, warnings,
    );
    const coached = normalizeBoolean(row, 'coached', row.coached, errors, warnings);
    const improved = normalizeBoolean(row, 'improved', row.improved, errors, warnings);

    if (needsCoaching === true && coached === null) {
      warnings.push(
        issue(
          row,
          'OPTIONAL_VALUE_MISSING',
          'WARNING',
          'coached',
          '项目需要辅导，但辅导结果为空；系统保留为空白并进入未辅导预警。',
          row.coached,
        ),
      );
    }
    if (coached === true && improved === null) {
      warnings.push(
        issue(
          row,
          'OPTIONAL_VALUE_MISSING',
          'WARNING',
          'improved',
          '项目已辅导，但改善结果为空；系统保留为空白。',
          row.improved,
        ),
      );
    }

    if (errors.length !== rowErrorStart || !assignedAt || !organization) continue;
    records.push({
      sourceSheet: row.sourceSheet,
      sourceRow: row.sourceRow,
      city,
      cityType: organization.cityType,
      region: organization.region,
      merchantId,
      merchantName: clean(row.merchantName) || null,
      assignmentId,
      projectId,
      businessSource: normalizeBusinessSource(
        row.businessSourceRaw ?? row.category ?? row.raw.F,
      ),
      category: clean(row.category) || null,
      assignedAt,
      followWithin30m,
      needsAnalyzed,
      hardInvite,
      needsCoaching,
      coached,
      improved,
      raw: row.raw,
    });
  }

  return { records, errors, warnings };
}

