import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { parseWorkbook } from '../src/parse-workbook';
import { validateBatch } from '../src/validate-batch';

const sourceFile = process.env.DESIGNBAO_SOURCE_XLSX;

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

describe.skipIf(!sourceFile)('supplied Designbao workbook', () => {
  it('reads only the two confirmed sheets and reports aggregate quality results', async () => {
    const parsed = await parseWorkbook(await readFile(sourceFile!));
    const validation = validateBatch(parsed);

    expect(parsed.sourceSheets).toEqual(['项目明细2', '工作表3']);
    expect(parsed.projects).toHaveLength(2065);
    expect(parsed.organizations).toHaveLength(48);
    expect(validation.errors).toContainEqual(
      expect.objectContaining({
        code: 'UNKNOWN_ORGANIZATION',
        field: 'city',
        rawValue: '张家港市',
      }),
    );

    const errorCounts = countBy(validation.errors, (item) => item.code);
    const warningCounts = countBy(validation.warnings, (item) => item.code);
    const errorFieldCounts = countBy(
      validation.errors,
      (item) => `${item.code}:${item.field}`,
    );
    const unknownCityCounts = countBy(
      validation.errors.filter((item) => item.code === 'UNKNOWN_ORGANIZATION'),
      (item) => String(item.rawValue ?? ''),
    );
    console.info(
      JSON.stringify({
        parsedProjects: parsed.projects.length,
        acceptedRecords: validation.records.length,
        errors: errorCounts,
        warnings: warningCounts,
        errorFields: errorFieldCounts,
        unknownCities: unknownCityCounts,
        parsedZhangjiagangRows: parsed.projects.filter(
          (item) => String(item.city).trim() === '张家港市',
        ).map((item) => item.sourceRow),
      }),
    );
  });
});
