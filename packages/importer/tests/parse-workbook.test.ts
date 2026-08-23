import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { sha256 } from '../src/hash-file';
import { projectColumns } from '../src/mappings';
import { expandMergedCellValues, parseWorkbook } from '../src/parse-workbook';

const fixtures = resolve('packages/test-fixtures/excel');

describe('parseWorkbook', () => {
  it('uses the workbook summary date column 分派时间1 before the assignment detail date', () => {
    expect(projectColumns.assignedAt[0]).toBe('分派时间1');
  });

  it('treats 类别 as the raw business source column', () => {
    expect(projectColumns.businessSource[0]).toBe('类别');
  });

  it('reads only 项目明细2 and 工作表3 using the real two-level headers', async () => {
    const buffer = await readFile(resolve(fixtures, 'designbao-valid.xlsx'));

    const parsed = await parseWorkbook(buffer);

    expect(parsed.sourceSheets).toEqual(['项目明细2', '工作表3']);
    expect(parsed.projects).toHaveLength(2);
    expect(parsed.projects[0]).toMatchObject({
      sourceSheet: '项目明细2',
      sourceRow: 4,
      city: '北京市',
      merchantId: 'M001',
      projectId: 'P001',
      businessSourceRaw: '设计宝',
      assignedAt: expect.any(Date),
      followWithin30m: '是',
      needsAnalyzed: '是',
      hardInvite: '否',
      needsCoaching: '需辅导',
      coached: null,
      improved: '否',
    });
    expect(parsed.projects[1]).toMatchObject({
      sourceRow: 5,
      merchantId: 'M002',
      projectId: 'P001',
    });
    expect(parsed.organizations).toEqual([
      {
        sourceSheet: '工作表3',
        sourceRow: 3,
        cityType: '战略城市',
        city: '北京市',
        region: '北京大区',
      },
      {
        sourceSheet: '工作表3',
        sourceRow: 4,
        cityType: '潜力城市',
        city: '上海市',
        region: '上海大区',
      },
    ]);
  });

  it('rejects a workbook when either selected sheet is missing', async () => {
    await expect(parseWorkbook(Buffer.from('not an xlsx'))).rejects.toThrow();
  });

  it('accepts 装修公司 as the merchant name header used by the supplied workbook', async () => {
    const fixture = await readFile(resolve(fixtures, 'designbao-valid.xlsx'));
    const zip = await JSZip.loadAsync(fixture);
    let replaced = false;
    for (const [path, entry] of Object.entries(zip.files)) {
      if (!path.startsWith('xl/worksheets/') || !path.endsWith('.xml')) continue;
      const source = await entry.async('string');
      if (!source.includes('装企名称')) continue;
      zip.file(path, source.replaceAll('装企名称', '装修公司'));
      replaced = true;
    }
    expect(replaced).toBe(true);

    const parsed = await parseWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));

    expect(parsed.projects[0]?.merchantName).toBe('示例装企A');
  });
});

describe('sha256', () => {
  it('returns a stable lowercase digest for duplicate-file detection', () => {
    expect(sha256(Buffer.from('designbao'))).toBe(
      'e052357f671657fa974fee676fa823e421f0f429e644bbad1a10842ce35cc0b9',
    );
  });
});

describe('expandMergedCellValues', () => {
  it('copies a merged project ID into every represented assignment row', () => {
    const rows = new Map([
      [4, new Map([[4, 'P001']])],
      [5, new Map<number, string>()],
    ]);

    expandMergedCellValues(rows, ['D4:D5']);

    expect(rows.get(5)?.get(4)).toBe('P001');
  });
});

