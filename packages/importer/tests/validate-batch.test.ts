import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseWorkbook } from '../src/parse-workbook';
import { validateBatch } from '../src/validate-batch';

const fixtures = resolve('packages/test-fixtures/excel');

async function validateFixture(name: string) {
  const parsed = await parseWorkbook(await readFile(resolve(fixtures, name)));
  return validateBatch(parsed);
}

describe('validateBatch', () => {
  it('normalizes dates and preserves blank separately from false', async () => {
    const result = await validateFixture('designbao-valid.xlsx');

    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      assignmentId: 'P001::M001',
      businessSource: 'DESIGNBAO',
      city: '北京市',
      region: '北京大区',
      assignedAt: '2026-08-19',
      followWithin30m: true,
      needsAnalyzed: true,
      hardInvite: false,
      needsCoaching: true,
      coached: null,
      improved: false,
    });
    expect(result.records[1]).toMatchObject({
      assignmentId: 'P001::M002',
      projectId: 'P001',
      city: '上海市',
      region: '上海大区',
      coached: true,
      improved: true,
    });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'OPTIONAL_VALUE_MISSING',
        sourceRow: 4,
        field: 'coached',
      }),
    );
  });

  it('normalizes Xiaohongshu and unknown channel values without merging them', async () => {
    const parsed = await parseWorkbook(
      await readFile(resolve(fixtures, 'designbao-valid.xlsx')),
    );
    parsed.projects[0]!.businessSourceRaw = '小红书';
    parsed.projects[1]!.businessSourceRaw = '未知渠道';

    const result = validateBatch(parsed);

    expect(result.records[0]?.businessSource).toBe('XIAOHONGSHU');
    expect(result.records[1]?.businessSource).toBe('OTHER');
  });

  it('skips rows with missing IDs or unknown cities as warnings', async () => {
    const result = await validateFixture('designbao-invalid.xlsx');
    const errorCodes = new Set(result.errors.map((issue) => issue.code));
    const warningCodes = new Set(result.warnings.map((issue) => issue.code));

    expect(errorCodes).toEqual(
      new Set(['DUPLICATE_PROJECT_ID']),
    );
    expect(warningCodes.has('MISSING_ID')).toBe(true);
    expect(warningCodes.has('UNKNOWN_ORGANIZATION')).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'UNKNOWN_ORGANIZATION',
        sourceRow: 5,
        field: 'city',
        rawValue: '张家港市',
      }),
    );
    expect(result.records.every((record) => record.assignmentId !== '')).toBe(true);
  });
});

