from __future__ import annotations

import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CELL_REF = re.compile(r"([A-Z]+)(\d+)")


def text_content(node: ET.Element | None) -> str:
    if node is None:
        return ""
    return "".join(node.itertext())


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return [text_content(item) for item in root.findall(f"{{{MAIN_NS}}}si")]


def worksheet_targets(archive: zipfile.ZipFile) -> dict[str, str]:
    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    return {
        rel.attrib["Id"]: "xl/" + rel.attrib["Target"].lstrip("/")
        for rel in rels.findall(f"{{{PACKAGE_REL_NS}}}Relationship")
        if rel.attrib.get("Type", "").endswith("/worksheet")
    }


def workbook_sheets(archive: zipfile.ZipFile) -> list[dict[str, str | None]]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    targets = worksheet_targets(archive)
    sheets = []
    sheet_collection = workbook.find(f"{{{MAIN_NS}}}sheets")
    if sheet_collection is None:
        return []
    for sheet in sheet_collection:
        rel_id = sheet.attrib[f"{{{REL_NS}}}id"]
        sheets.append(
            {
                "name": sheet.attrib["name"],
                "state": sheet.attrib.get("state", "visible"),
                "target": targets[rel_id],
            }
        )
    return sheets


def cell_value(cell: ET.Element, strings: list[str]) -> str | None:
    cell_type = cell.attrib.get("t")
    value = cell.find(f"{{{MAIN_NS}}}v")
    if cell_type == "inlineStr":
        return text_content(cell.find(f"{{{MAIN_NS}}}is"))
    if value is None or value.text is None:
        formula = cell.find(f"{{{MAIN_NS}}}f")
        return f"={formula.text}" if formula is not None and formula.text else None
    if cell_type == "s":
        index = int(value.text)
        return strings[index] if index < len(strings) else f"<shared:{index}>"
    if cell_type == "b":
        return "TRUE" if value.text == "1" else "FALSE"
    return value.text


def column_number(reference: str) -> int:
    match = CELL_REF.fullmatch(reference)
    if not match:
        return 0
    result = 0
    for character in match.group(1):
        result = result * 26 + ord(character) - ord("A") + 1
    return result


def inspect_sheet(
    archive: zipfile.ZipFile,
    target: str,
    strings: list[str],
    profile_columns: set[int],
    data_start_row: int,
) -> dict[str, object]:
    root = ET.fromstring(archive.read(target))
    dimension = root.find(f"{{{MAIN_NS}}}dimension")
    rows = root.findall(f".//{{{MAIN_NS}}}sheetData/{{{MAIN_NS}}}row")
    candidates = []
    for row in rows[:30]:
        cells = []
        for cell in row.findall(f"{{{MAIN_NS}}}c"):
            value = cell_value(cell, strings)
            if value not in (None, ""):
                cells.append(
                    {
                        "ref": cell.attrib.get("r", ""),
                        "column": column_number(cell.attrib.get("r", "")),
                        "value": value,
                    }
                )
        candidates.append({"row": int(row.attrib.get("r", "0")), "cells": cells})

    header = max(candidates, key=lambda item: len(item["cells"]), default={"row": 0, "cells": []})
    formula_count = len(root.findall(f".//{{{MAIN_NS}}}f"))
    merged = root.find(f"{{{MAIN_NS}}}mergeCells")
    profiles: dict[int, Counter[str]] = {
        column: Counter() for column in profile_columns
    }
    non_empty = Counter[int]()
    formula_cells = Counter[int]()
    style_ids: dict[int, Counter[str]] = {
        column: Counter() for column in profile_columns
    }
    data_rows = [row for row in rows if int(row.attrib.get("r", "0")) >= data_start_row]
    for row in data_rows:
        for cell in row.findall(f"{{{MAIN_NS}}}c"):
            column = column_number(cell.attrib.get("r", ""))
            value = cell_value(cell, strings)
            if value not in (None, ""):
                non_empty[column] += 1
            if cell.find(f"{{{MAIN_NS}}}f") is not None:
                formula_cells[column] += 1
            if column in profile_columns and value not in (None, ""):
                profiles[column][str(value).strip()] += 1
                style_ids[column][cell.attrib.get("s", "0")] += 1
    return {
        "dimension": dimension.attrib.get("ref") if dimension is not None else None,
        "xmlRowCount": len(rows),
        "headerCandidateRow": header["row"],
        "headerCandidate": header["cells"],
        "firstThreeRows": candidates[:3],
        "dataRowShape": [
            {
                "row": item["row"],
                "presentColumns": [cell["ref"] for cell in item["cells"]],
                "safeValues": {
                    cell["ref"]: cell["value"]
                    for cell in item["cells"]
                    if cell["column"] in {1, 6, 9, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26}
                },
            }
            for item in candidates
            if 4 <= item["row"] <= 12
        ],
        "mergedCells": [
            item.attrib["ref"] for item in list(merged)[:100]
        ] if merged is not None else [],
        "first30NonEmptyCounts": [
            {"row": item["row"], "count": len(item["cells"])} for item in candidates
        ],
        "formulaCount": formula_count,
        "profiledDataRows": len(data_rows),
        "columnProfiles": {
            str(column): {
                "nonEmpty": non_empty[column],
                "blank": len(data_rows) - non_empty[column],
                "formulaCells": formula_cells[column],
                "styleIds": style_ids[column].most_common(8),
                "topValues": profiles[column].most_common(20),
            }
            for column in sorted(profile_columns)
        },
    }


def raw_rows(
    archive: zipfile.ZipFile,
    target: str,
    strings: list[str],
    start_row: int,
) -> list[dict[int, str]]:
    root = ET.fromstring(archive.read(target))
    records: list[dict[int, str]] = []
    for row in root.findall(f".//{{{MAIN_NS}}}sheetData/{{{MAIN_NS}}}row"):
        if int(row.attrib.get("r", "0")) < start_row:
            continue
        record: dict[int, str] = {}
        record[0] = row.attrib.get("r", "0")
        for cell in row.findall(f"{{{MAIN_NS}}}c"):
            value = cell_value(cell, strings)
            if value not in (None, ""):
                record[column_number(cell.attrib.get("r", ""))] = str(value).strip()
        records.append(record)
    return records


def project_merge_summary(
    archive: zipfile.ZipFile,
    target: str,
    strings: list[str],
) -> dict[str, object]:
    root = ET.fromstring(archive.read(target))
    rows: dict[int, dict[int, str]] = {}
    for row in root.findall(f".//{{{MAIN_NS}}}sheetData/{{{MAIN_NS}}}row"):
        row_number = int(row.attrib.get("r", "0"))
        values: dict[int, str] = {}
        for cell in row.findall(f"{{{MAIN_NS}}}c"):
            value = cell_value(cell, strings)
            if value not in (None, ""):
                values[column_number(cell.attrib.get("r", ""))] = str(value).strip()
        rows[row_number] = values

    merged = root.find(f"{{{MAIN_NS}}}mergeCells")
    project_ranges: list[tuple[int, int]] = []
    if merged is not None:
        for item in merged:
            match = re.fullmatch(r"D(\d+):D(\d+)", item.attrib.get("ref", ""))
            if match:
                project_ranges.append((int(match.group(1)), int(match.group(2))))

    groups = []
    for start, end in project_ranges:
        group_rows = [rows.get(row_number, {}) for row_number in range(start, end + 1)]
        merchants = {row.get(2, "") for row in group_rows if row.get(2, "")}
        groups.append(
            {
                "startRow": start,
                "endRow": end,
                "rowCount": end - start + 1,
                "distinctMerchantCount": len(merchants),
                "categories": sorted({row.get(6, "") for row in group_rows if row.get(6, "")}),
                "assignedDates": sorted({row.get(9, "") for row in group_rows if row.get(9, "")}),
                "followValues": [row.get(14, "") for row in group_rows],
                "needsValues": [row.get(15, "") for row in group_rows],
                "hardInviteValues": [row.get(16, "") for row in group_rows],
            }
        )

    return {
        "mergedProjectGroups": len(groups),
        "groupSizes": Counter(group["rowCount"] for group in groups).most_common(),
        "sameMerchantGroups": sum(group["distinctMerchantCount"] == 1 for group in groups),
        "differentMerchantGroups": sum(group["distinctMerchantCount"] > 1 for group in groups),
        "sampleGroups": groups[:8],
        "sampleSameMerchantGroups": [
            group for group in groups if group["distinctMerchantCount"] == 1
        ][:8],
        "sampleMissingMerchantGroups": [
            group for group in groups if group["distinctMerchantCount"] == 0
        ][:8],
    }


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: inspect-designbao-source.py <workbook.xlsx>")
    source = Path(sys.argv[1])
    selected = {"项目明细2", "工作表3"}
    with zipfile.ZipFile(source) as archive:
        strings = shared_strings(archive)
        sheets = workbook_sheets(archive)
        sheet_by_name = {item["name"]: item for item in sheets}
        project_rows = raw_rows(
            archive, str(sheet_by_name["项目明细2"]["target"]), strings, 4
        )
        organization_rows = raw_rows(
            archive, str(sheet_by_name["工作表3"]["target"]), strings, 3
        )
        city_mappings: dict[str, set[tuple[str, str]]] = {}
        for row in organization_rows:
            if 3 not in row:
                continue
            city_mappings.setdefault(row[3], set()).add((row.get(2, ""), row.get(4, "")))
        active_project_rows = [
            row for row in project_rows if any(column != 0 for column in row)
        ]
        project_cities = {row[1] for row in active_project_rows if 1 in row}
        mapped_project_rows = sum(
            1 for row in active_project_rows if row.get(1) in city_mappings
        )
        result = {
            "source": source.name,
            "availableSheets": [
                {"name": item["name"], "state": item["state"]} for item in sheets
            ],
            "selectedSheets": {
                item["name"]: {
                    "state": item["state"],
                    **inspect_sheet(
                        archive,
                        str(item["target"]),
                        strings,
                        ({1, 6, 9, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 34, 35, 36, 42}
                         if item["name"] == "项目明细2" else {2, 3, 4}),
                        4 if item["name"] == "项目明细2" else 3,
                    ),
                }
                for item in sheets
                if item["name"] in selected
            },
            "organizationJoin": {
                "join": "项目明细2.A（城市）= 工作表3.C（装企城市）",
                "projectCityCount": len(project_cities),
                "mappingCityCount": len(city_mappings),
                "mappedProjectRows": mapped_project_rows,
                "unmappedProjectRows": len(active_project_rows) - mapped_project_rows,
                "unmappedCities": sorted(project_cities - set(city_mappings)),
                "unmappedRows": [
                    int(row[0]) for row in active_project_rows if row.get(1) not in city_mappings
                ],
                "unmappedRowShape": [
                    {
                        "row": int(row[0]),
                        "columns": sorted(column for column in row if column != 0),
                        "safeValues": {
                            str(column): value
                            for column, value in row.items()
                            if column in {1, 6, 9, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26}
                        },
                    }
                    for row in active_project_rows
                    if row.get(1) not in city_mappings
                ],
                "conflictingCities": {
                    city: sorted(values)
                    for city, values in city_mappings.items()
                    if len(values) > 1
                },
            },
            "projectMergeSummary": project_merge_summary(
                archive, str(sheet_by_name["项目明细2"]["target"]), strings
            ),
        }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
