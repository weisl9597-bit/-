import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';

import {
  normalizeHeader,
  organizationColumns,
  projectColumns,
  selectedSheets,
} from './mappings';

export type WorkbookCellValue = string | number | boolean | Date | null;

export type ParsedProjectRow = {
  sourceSheet: '项目明细2';
  sourceRow: number;
  city: WorkbookCellValue;
  merchantId: WorkbookCellValue;
  merchantName: WorkbookCellValue;
  projectId: WorkbookCellValue;
  category: WorkbookCellValue;
  assignedAt: WorkbookCellValue;
  followWithin30m: WorkbookCellValue;
  needsAnalyzed: WorkbookCellValue;
  hardInvite: WorkbookCellValue;
  needsCoaching: WorkbookCellValue;
  coached: WorkbookCellValue;
  improved: WorkbookCellValue;
  raw: Record<string, WorkbookCellValue>;
};

export type ParsedOrganizationRow = {
  sourceSheet: '工作表3';
  sourceRow: number;
  cityType: string;
  city: string;
  region: string;
};

export type ParsedWorkbook = {
  sourceSheets: ['项目明细2', '工作表3'];
  projects: ParsedProjectRow[];
  organizations: ParsedOrganizationRow[];
  projectHeaders: Record<string, string>;
};

type XmlValue = string | number | boolean | null | XmlObject | XmlValue[];
type XmlObject = { [key: string]: XmlValue | undefined };

type SheetData = {
  rows: Map<number, Map<number, WorkbookCellValue>>;
  originalRows: Map<number, Map<number, WorkbookCellValue>>;
  maxColumn: number;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
  removeNSPrefix: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function object(value: XmlValue | undefined): XmlObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function text(value: XmlValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(text).join('');
  if ('#text' in value) return text(value['#text']);
  return '';
}

function richText(value: XmlValue | undefined): string {
  const node = object(value);
  if (node.t !== undefined) return text(node.t);
  return asArray(node.r).map((run) => text(object(run).t)).join('');
}

function columnNumber(reference: string): number {
  const match = /^([A-Z]+)\d+$/.exec(reference);
  if (!match?.[1]) return 0;
  return [...match[1]].reduce(
    (result, character) => result * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

function columnName(column: number): string {
  let current = column;
  let result = '';
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

function cellCoordinate(reference: string): { column: number; row: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(reference);
  if (!match?.[1] || !match[2]) return null;
  return {
    column: columnNumber(`${match[1]}${match[2]}`),
    row: Number(match[2]),
  };
}

export function expandMergedCellValues<T extends WorkbookCellValue>(
  rows: Map<number, Map<number, T>>,
  mergeReferences: string[],
): void {
  for (const reference of mergeReferences) {
    const [startReference, endReference] = reference.split(':');
    if (!startReference || !endReference) continue;
    const start = cellCoordinate(startReference);
    const end = cellCoordinate(endReference);
    if (!start || !end) continue;
    const master = rows.get(start.row)?.get(start.column);
    if (master === undefined || master === null) continue;

    for (let row = start.row; row <= end.row; row += 1) {
      const rowValues = rows.get(row) ?? new Map<number, T>();
      rows.set(row, rowValues);
      for (let column = start.column; column <= end.column; column += 1) {
        if (!rowValues.has(column) || rowValues.get(column) === null) {
          rowValues.set(column, master);
        }
      }
    }
  }
}

function parseScalar(raw: string): WorkbookCellValue {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : raw;
}

function parseCell(
  cellValue: XmlValue,
  sharedStrings: string[],
): { column: number; value: WorkbookCellValue } | null {
  const cell = object(cellValue);
  const reference = text(cell['@_r']);
  const column = columnNumber(reference);
  if (!column) return null;
  const type = text(cell['@_t']);

  if (type === 'inlineStr') {
    return { column, value: richText(cell.is) || null };
  }

  const raw = text(cell.v);
  if (type === 's') {
    const index = Number(raw);
    return { column, value: sharedStrings[index] ?? null };
  }
  if (type === 'b') return { column, value: raw === '1' };
  if (type === 'str' || type === 'e') return { column, value: raw || null };
  return { column, value: parseScalar(raw) };
}

async function readXml(zip: JSZip, path: string): Promise<XmlObject> {
  const entry = zip.file(path);
  if (!entry) throw new Error(`Excel 文件缺少必要内容：${path}`);
  const source = await entry.async('string');
  if (/<!DOCTYPE/i.test(source)) {
    throw new Error(`Excel 文件包含不允许的 XML 声明：${path}`);
  }
  return object(xmlParser.parse(source) as XmlValue);
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  if (!zip.file('xl/sharedStrings.xml')) return [];
  const document = await readXml(zip, 'xl/sharedStrings.xml');
  const root = object(document.sst);
  return asArray(root.si).map(richText);
}

async function resolveSelectedSheetPaths(
  zip: JSZip,
): Promise<Record<(typeof selectedSheets)[number], string>> {
  const workbook = object((await readXml(zip, 'xl/workbook.xml')).workbook);
  const sheets = asArray(object(workbook.sheets).sheet);
  const relationships = object(
    (await readXml(zip, 'xl/_rels/workbook.xml.rels')).Relationships,
  );
  const targetById = new Map(
    asArray(relationships.Relationship).map((relationshipValue) => {
      const relationship = object(relationshipValue);
      return [text(relationship['@_Id']), text(relationship['@_Target'])] as const;
    }),
  );

  const result = {} as Record<(typeof selectedSheets)[number], string>;
  for (const sheetValue of sheets) {
    const sheet = object(sheetValue);
    const name = text(sheet['@_name']);
    if (!selectedSheets.includes(name as (typeof selectedSheets)[number])) continue;
    const relationshipId = text(sheet['@_id'] ?? sheet['@_r:id']);
    const target = targetById.get(relationshipId);
    if (!target) throw new Error(`无法定位子表：${name}`);
    result[name as (typeof selectedSheets)[number]] = `xl/${target.replace(/^\/?xl\//, '').replace(/^\//, '')}`;
  }

  for (const name of selectedSheets) {
    if (!result[name]) throw new Error(`Excel 缺少必需子表：${name}`);
  }
  return result;
}

async function readSheet(
  zip: JSZip,
  path: string,
  sharedStrings: string[],
): Promise<SheetData> {
  const worksheet = object((await readXml(zip, path)).worksheet);
  const rowValues = asArray(object(worksheet.sheetData).row);
  const rows = new Map<number, Map<number, WorkbookCellValue>>();
  let maxColumn = 0;

  for (const rowValue of rowValues) {
    const row = object(rowValue);
    const rowNumber = Number(text(row['@_r']));
    if (!Number.isInteger(rowNumber)) continue;
    const values = new Map<number, WorkbookCellValue>();
    for (const cellValue of asArray(row.c)) {
      const parsed = parseCell(cellValue, sharedStrings);
      if (!parsed) continue;
      values.set(parsed.column, parsed.value);
      maxColumn = Math.max(maxColumn, parsed.column);
    }
    rows.set(rowNumber, values);
  }
  const originalRows = new Map(
    [...rows].map(([rowNumber, values]) => [rowNumber, new Map(values)]),
  );
  const mergeReferences = asArray(object(worksheet.mergeCells).mergeCell)
    .map((mergeCell) => text(object(mergeCell)['@_ref']))
    .filter(Boolean);
  expandMergedCellValues(rows, mergeReferences);
  return { rows, originalRows, maxColumn };
}

function findColumns<T extends Record<string, readonly string[]>>(
  sheet: SheetData,
  headerRows: number[],
  definitions: T,
): Record<keyof T, number> {
  const cells = headerRows.flatMap((rowNumber) =>
    [...(sheet.rows.get(rowNumber) ?? new Map()).entries()],
  );
  const result = {} as Record<keyof T, number>;
  for (const [field, aliases] of Object.entries(definitions)) {
    let match = 0;
    for (const alias of aliases) {
      match = cells.find(([, value]) => normalizeHeader(value) === normalizeHeader(alias))?.[0] ?? 0;
      if (match) break;
    }
    if (!match) throw new Error(`子表缺少必需字段：${aliases[0] ?? field}`);
    result[field as keyof T] = match;
  }
  return result;
}

function valueAt(
  row: Map<number, WorkbookCellValue>,
  column: number,
): WorkbookCellValue {
  return row.get(column) ?? null;
}

function dateCell(value: WorkbookCellValue): WorkbookCellValue {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000));
}

function projectHeaderMap(sheet: SheetData): Record<string, string> {
  const headers: Record<string, string> = {};
  for (let column = 1; column <= sheet.maxColumn; column += 1) {
    const second = valueAt(sheet.rows.get(2) ?? new Map(), column);
    const third = valueAt(sheet.rows.get(3) ?? new Map(), column);
    const header = second ?? third;
    if (header !== null) headers[columnName(column)] = String(header).trim();
  }
  return headers;
}

export async function parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const paths = await resolveSelectedSheetPaths(zip);
  const sharedStrings = await readSharedStrings(zip);
  const projectSheet = await readSheet(zip, paths['项目明细2'], sharedStrings);
  const organizationSheet = await readSheet(zip, paths['工作表3'], sharedStrings);
  const projectColumn = findColumns(projectSheet, [1, 2, 3], projectColumns);
  const organizationColumn = findColumns(
    organizationSheet,
    [1, 2],
    organizationColumns,
  );

  const projects: ParsedProjectRow[] = [];
  for (const [sourceRow, row] of projectSheet.rows) {
    if (sourceRow < 4) continue;
    const originalRow = projectSheet.originalRows.get(sourceRow) ?? new Map();
    const raw = Object.fromEntries(
      [...originalRow.entries()].map(([column, value]) => [columnName(column), value]),
    );
    if (Object.values(raw).every((value) => value === null || value === '')) continue;
    projects.push({
      sourceSheet: '项目明细2',
      sourceRow,
      city: valueAt(row, projectColumn.city),
      merchantId: valueAt(row, projectColumn.merchantId),
      merchantName: valueAt(row, projectColumn.merchantName),
      projectId: valueAt(row, projectColumn.projectId),
      category: valueAt(row, projectColumn.category),
      assignedAt: dateCell(valueAt(row, projectColumn.assignedAt)),
      followWithin30m: valueAt(row, projectColumn.followWithin30m),
      needsAnalyzed: valueAt(row, projectColumn.needsAnalyzed),
      hardInvite: valueAt(row, projectColumn.hardInvite),
      needsCoaching: valueAt(row, projectColumn.needsCoaching),
      coached: valueAt(row, projectColumn.coached),
      improved: valueAt(row, projectColumn.improved),
      raw,
    });
  }

  const organizations: ParsedOrganizationRow[] = [];
  for (const [sourceRow, row] of organizationSheet.rows) {
    if (sourceRow < 3) continue;
    const city = String(valueAt(row, organizationColumn.city) ?? '').trim();
    const region = String(valueAt(row, organizationColumn.region) ?? '').trim();
    const cityType = String(valueAt(row, organizationColumn.cityType) ?? '').trim();
    if (!city && !region && !cityType) continue;
    organizations.push({
      sourceSheet: '工作表3',
      sourceRow,
      cityType,
      city,
      region,
    });
  }

  return {
    sourceSheets: ['项目明细2', '工作表3'],
    projects,
    organizations,
    projectHeaders: projectHeaderMap(projectSheet),
  };
}
