"""Inventory Wolai tables and identify record links without guessing from their titles."""
import argparse
import json
import re
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
from markdown_links import blocks, refs


def cells(line):
    return [cell.strip().replace(r"\|", "|") for cell in re.split(r"(?<!\\)\|", line.strip()[1:-1])]


def record(cell):
    links = list(refs(cell))
    if len(links) != 1:
        return None
    start, end, image, title, path = links[0]
    match = re.search(r"_([A-Za-z0-9_-]{20,24})\.md$", PurePosixPath(path).name)
    if start or end != len(cell) or image or not match:
        return None
    return {"id": match[1], "title": title.replace(r"\_", "_")}


def tables(markdown):
    lines = markdown.splitlines()
    previous = ""
    consumed = 0
    for start, end, kind, value in blocks(lines):
        if start < consumed:
            continue
        if kind != "表格行" or not lines[start].strip().startswith("|"):
            previous = value.strip()
            continue
        while end < len(lines) and lines[end].strip().startswith("|") and lines[end].rstrip().endswith("|"):
            end += 1
        consumed = end
        grid = [cells(line) for line in lines[start:end]]
        if len(grid) < 2 or not all(re.fullmatch(r":?-+:?", c) for c in grid[1]):
            previous = value
            continue
        fields, data = grid[0], grid[2:]
        candidates = []
        if data and all(len(row) == len(fields) for row in data):
            for i in range(len(fields)):
                links = [record(row[i]) for row in data]
                if all(links) and len({link["id"] for link in links}) == len(links):
                    candidates.append((i, links))
        column, rows = candidates[0] if len(candidates) == 1 else (None, [])
        role = "simple" if previous.startswith("<!-- wolai-table:") else "row-links" if rows else "undetermined"
        yield {"line": start+1, "role": role, "fields": fields, "title_column": column,
               "caption": previous[5:].strip() if previous.startswith("#### ") else "",
               "records": [dict(row, values={f: raw[i] for i, f in enumerate(fields) if i != column})
                           for row, raw in zip(rows, data)]}
        previous = value


def property_prefix(content, fields, expected):
    lines = content.splitlines()
    index = next((i for i, s in enumerate(lines) if s.strip()), len(lines))
    if index < len(lines) and lines[index].startswith("# "):
        index += 1
    while index < len(lines) and not lines[index].strip():
        index += 1
    end = index
    while end < len(lines) and lines[end].strip().startswith("|"):
        end += 1
    table = [cells(line) for line in lines[index:end]]
    if len(table) < 2 or not all(re.fullmatch(r":?-+:?", c) for c in table[1]):
        return None
    pairs = table[:1]+table[2:]
    if not all(len(row) == 2 for row in pairs):
        return None
    actual = dict(pairs)
    if len(actual) == len(pairs) and set(actual) == set(fields) and actual == expected:
        return "\n".join(lines[index:end])
    return None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    with ZipFile(args.archive) as archive:
        inventory = {n: list(tables(archive.read(n).decode("utf-8-sig"))) for n in archive.namelist() if n.endswith(".md")}
    args.output.write_text(json.dumps({n:t for n,t in inventory.items() if t}, ensure_ascii=False, indent=2), encoding="utf8")
