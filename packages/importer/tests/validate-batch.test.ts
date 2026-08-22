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

  it('reports every blocking data-quality class without silently accepting rows', async () => {
    const result = await validateFixture('designbao-invalid.xlsx');
    const codes = new Set(result.errors.map((issue) => issue.code));

    expect(codes).toEqual(
      new Set([
        'MISSING_ID',
        'DUPLICATE_PROJECT_ID',
        'INVALID_DATE',
        'UNKNOWN_ORGANIZATION',
        'INVALID_ENUM',
      ]),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'UNKNOWN_ORGANIZATION',
        sourceRow: 5,
        field: 'city',
        rawValue: '张家港市',
      }),
    );
  });
});
