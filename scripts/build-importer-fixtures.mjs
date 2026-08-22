import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const workspace = process.cwd();
const fixtureDir = path.join(workspace, "packages", "test-fixtures", "excel");
const previewDir = path.join(workspace, ".tmp", "spreadsheet-fixtures", "previews");

const headerFormat = {
  fill: "#E8F0FE",
  font: { bold: true, color: "#1F2937" },
  verticalAlignment: "center",
  wrapText: true,
};

function addProjectSheet(workbook, rows) {
  const sheet = workbook.worksheets.add("项目明细2");
  sheet.showGridLines = false;
  sheet.getRange("A2:Z3").format = headerFormat;
  sheet.getRange("A2:Z3").format.rowHeight = 28;

  const fixedHeaders = [
    ["A2", "城市"],
    ["B2", "装企ID"],
    ["C2", "装企名称"],
    ["D2", "项目id"],
    ["F2", "类别"],
    ["I2", "分派时间"],
    ["W2", "是否需辅导装企"],
    ["Y2", "城市辅导结果（分公司填写）"],
    ["Z2", "辅导次日是否在群内有改变（总部检核填写）"],
  ];
  for (const [cell, value] of fixedHeaders) {
    sheet.getRange(cell).values = [[value]];
    const column = cell.match(/[A-Z]+/)[0];
    sheet.mergeCells(`${column}2:${column}3`);
  }

  sheet.getRange("N2:P2").merge();
  sheet.getRange("N2").values = [["拉群后SOP执行"]];
  sheet.getRange("N3:P3").values = [[
    "30min内跟进",
    "详细需求沟通或户型解析",
    "硬约沟通/量房",
  ]];

  rows.forEach((row, index) => {
    const excelRow = index + 4;
    const values = new Map([
      ["A", row.city],
      ["B", row.merchantId],
      ["C", row.merchantName],
      ["D", row.projectId],
      ["F", row.category],
      ["I", row.assignedAt],
      ["N", row.followWithin30m],
      ["O", row.needsAnalyzed],
      ["P", row.hardInvite],
      ["W", row.needsCoaching],
      ["Y", row.coached],
      ["Z", row.improved],
    ]);
    for (const [column, value] of values) {
      sheet.getRange(`${column}${excelRow}`).values = [[value]];
    }
  });

  sheet.getRange(`I4:I${rows.length + 3}`).format.numberFormat = "yyyy-mm-dd";
  sheet.freezePanes.freezeRows(3);
  const widths = {
    A: 12, B: 14, C: 18, D: 14, F: 10, I: 14,
    N: 14, O: 24, P: 16, W: 18, Y: 24, Z: 30,
  };
  for (const [column, width] of Object.entries(widths)) {
    sheet.getRange(`${column}1:${column}${rows.length + 3}`).format.columnWidth = width;
  }
  return sheet;
}

function addOrganizationSheet(workbook) {
  const sheet = workbook.worksheets.add("工作表3");
  sheet.showGridLines = false;
  sheet.getRange("B1:D2").format = headerFormat;
  for (const [column, label] of [["B", "城市类型"], ["C", "装企城市"], ["D", "大区"]]) {
    sheet.getRange(`${column}1`).values = [[label]];
    sheet.mergeCells(`${column}1:${column}2`);
  }
  sheet.getRange("B3:D4").values = [
    ["战略城市", "北京市", "北京大区"],
    ["潜力城市", "上海市", "上海大区"],
  ];
  sheet.getRange("B1:D4").format.columnWidth = 16;
  sheet.freezePanes.freezeRows(2);
  return sheet;
}

async function buildFixture(fileName, projectRows) {
  const workbook = Workbook.create();
  const projectSheet = addProjectSheet(workbook, projectRows);
  if (fileName === "designbao-valid.xlsx") {
    projectSheet.mergeCells("D4:D5");
  }
  addOrganizationSheet(workbook);

  const inspection = await workbook.inspect({
    kind: "sheet,table",
    maxChars: 3000,
    tableMaxRows: 8,
    tableMaxCols: 12,
  });
  console.log(inspection.ndjson);

  for (const sheetName of ["项目明细2", "工作表3"]) {
    const preview = await workbook.render({
      sheetName,
      autoCrop: "all",
      scale: 1.2,
      format: "png",
    });
    await fs.writeFile(
      path.join(previewDir, `${fileName}-${sheetName}.png`),
      new Uint8Array(await preview.arrayBuffer()),
    );
  }

  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 50 },
    summary: `${fileName} formula error scan`,
  });
  console.log(errors.ndjson);

  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(path.join(fixtureDir, fileName));
}

await fs.mkdir(fixtureDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

await buildFixture("designbao-valid.xlsx", [
  {
    city: "北京市",
    merchantId: "M001",
    merchantName: "示例装企A",
    projectId: "P001",
    category: "设计宝",
    assignedAt: new Date("2026-08-19T00:00:00+08:00"),
    followWithin30m: "是",
    needsAnalyzed: "是",
    hardInvite: "否",
    needsCoaching: "需辅导",
    coached: null,
    improved: "否",
  },
  {
    city: "上海市",
    merchantId: "M002",
    merchantName: "示例装企B",
    projectId: "P001",
    category: "小红书",
    assignedAt: new Date("2026-08-18T00:00:00+08:00"),
    followWithin30m: "否",
    needsAnalyzed: "是",
    hardInvite: "否",
    needsCoaching: "无需辅导",
    coached: "已辅导",
    improved: "是",
  },
]);

await buildFixture("designbao-invalid.xlsx", [
  {
    city: "北京市",
    merchantId: null,
    merchantName: "示例装企C",
    projectId: "P100",
    category: "设计宝",
    assignedAt: "不是日期",
    followWithin30m: "可能",
    needsAnalyzed: "是",
    hardInvite: "否",
    needsCoaching: "需辅导",
    coached: null,
    improved: "否",
  },
  {
    city: "张家港市",
    merchantId: "M100",
    merchantName: "示例装企D",
    projectId: "P-DUP",
    category: "设计宝",
    assignedAt: new Date("2026-08-19T00:00:00+08:00"),
    followWithin30m: "是",
    needsAnalyzed: "是",
    hardInvite: "否",
    needsCoaching: "需辅导",
    coached: "已辅导",
    improved: "未知",
  },
  {
    city: "北京市",
    merchantId: "M100",
    merchantName: "示例装企E",
    projectId: "P-DUP",
    category: "设计宝",
    assignedAt: new Date("2026-08-17T00:00:00+08:00"),
    followWithin30m: "是",
    needsAnalyzed: "否",
    hardInvite: "否",
    needsCoaching: "无需辅导",
    coached: null,
    improved: null,
  },
]);
