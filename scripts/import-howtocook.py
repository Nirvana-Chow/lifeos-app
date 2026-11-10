#!/usr/bin/env python3
"""Regenerate LifeOS's text-only HowToCook catalog from the pinned archive."""

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
from urllib.parse import quote

COMMIT = "a0b14bd388ee996943173679c3a7c9db7da04a6c"
ARCHIVE_SHA256 = "b0913c7df69690868a9677a7e9f14797219311ea13754c6c1997efda248337ee"
SOURCE = "https://github.com/Anduin2017/HowToCook"
CATEGORY_COUNTS = {
    "vegetable_dish": 60,
    "meat_dish": 103,
    "aquatic": 27,
    "staple": 58,
    "breakfast": 25,
    "soup": 23,
    "dessert": 19,
    "drink": 23,
    "condiment": 9,
    "semi-finished": 10,
}
HEADINGS = ["必备原料和工具", "计算", "操作", "附加内容"]
IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
INLINE_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
HTML_TAG = re.compile(r"<\/?[a-z][^>]*>", re.IGNORECASE)
LIST_ITEM = re.compile(r"^([ \t]*)(?:[-*+]|\d+[.)])\s+(.*)$")
LEADING_QUANTITY = re.compile(r"^\d+(?:\.\d+)?\s*(?:毫升|公斤|千克|ml|g|克|斤|两|个|片|颗|枚|勺|只|瓣|根|袋|盒|块)\s*", re.IGNORECASE)
TOOL_HEADING = re.compile(r"^(?:必备|所需|可选|主要)?(?:工具|厨具|器具)[：:]?$")
TOOL_NAME = re.compile(
    r"^(?:水果刀|菜刀|砧板|案板|筷子|铲子|锅铲|汤勺|搅拌棒|打蛋器|料理机|破壁机|厨师机|"
    r"烤箱|烤盘|烤架|微波炉|电饭煲|空气炸锅|平底锅|不粘锅|炒锅|蒸锅|砂锅|"
    r"煲汤盅|高压锅|压力锅|漏勺|滤网|筛网|电子秤|量杯|刮刀|擀面杖|保鲜膜|烘焙纸|锡纸)$"
)


def plain_text(line):
    line = IMAGE.sub("", line)
    line = INLINE_LINK.sub(r"\1", line)
    line = HTML_TAG.sub("", line)
    line = re.sub(r"\*\*(?=\S)([^*]+?)(?<=\S)\*\*|(?<!\*)\*(?=\S)([^*]+?)(?<=\S)\*(?!\*)", lambda match: next(
        text for text in match.groups() if text is not None
    ), line)
    return line.replace(chr(96), "").strip()


def recipe_lines(text):
    columns = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [plain_text(cell) for cell in stripped[1:-1].split("|")]
            if not columns:
                columns = cells
            elif not all(re.fullmatch(r":?-+:?", cell) for cell in cells):
                if len(cells) != len(columns):
                    raise ValueError(f"Invalid recipe table row: {stripped}")
                yield " · ".join(f"{label}：{value}" for label, value in zip(columns, cells))
            continue
        columns = []
        if not stripped or re.fullmatch(r"[-*_]{3,}", stripped):
            continue
        if stripped.startswith("如果您遵循本指南的制作流程"):
            continue
        if re.match(r"^#{3,6}\s+", stripped):
            title = plain_text(re.sub(r"^#+\s+", "", stripped))
            if title:
                yield f"# {title}"
            continue
        item = LIST_ITEM.match(line)
        if item:
            content = plain_text(item[2])
            if content:
                indent = min(len(item[1].expandtabs(2)) // 2, 3)
                yield ("  " * indent) + content
            continue
        content = plain_text(re.sub(r"^>\s*", "", stripped))
        if content:
            yield content


def ingredient_terms(text):
    terms = {}
    tool_section = False
    for line in text.splitlines():
        item = LIST_ITEM.match(line)
        if not item:
            heading = re.sub(r"^#+\s+", "", line.strip())
            if heading:
                tool_section = bool(TOOL_HEADING.fullmatch(heading))
            continue
        if tool_section:
            continue
        term = plain_text(item[2])
        term = LEADING_QUANTITY.sub("", term)
        term = re.sub(r"\s*[（(][^）)]*[）)]", "", term).strip()
        term = re.split(r"[，,：:]|\s*[=＝]\s*|\s*[0-9]+(?:[.][0-9]+)?\s*[a-zA-Z克毫升斤两个片颗枚勺只瓣根袋盒块]", term, maxsplit=1)[0]
        term = re.sub(r"\s*适量$", "", term).strip()
        if term and len(term) <= 32 and not TOOL_NAME.fullmatch(term):
            terms[term] = None
    return list(terms)


def parse_recipe(path, document):
    document = re.sub(r"<!--.*?-->", "", document, flags=re.DOTALL)
    pieces = re.split(r"^## ([^\n]+)$", document, flags=re.MULTILINE)
    difficulty = re.search(r"^预估烹饪难度[：:]\s*(★{1,5})\s*$", pieces[0], flags=re.MULTILINE)
    if not difficulty or pieces[1::2] != HEADINGS:
        raise ValueError(f"Unexpected difficulty or sections: {path}")
    sections = [
        {"title": title, "lines": list(recipe_lines(body))}
        for title, body in zip(pieces[1::2], pieces[2::2])
    ]
    if path == "dishes/meat_dish/虎皮肘子.md":
        quantities = sections[1]["lines"]
        typo = quantities.index("原料：冰糖 · 数量：5 · 单位：桶")
        quantities[typo] = "冰糖：原表单位待核对，参见炖煮步骤。"
    if not sections[0]["lines"] or not sections[2]["lines"]:
        raise ValueError(f"Missing ingredients or instructions: {path}")
    return {
        "id": hashlib.sha256(path.encode()).hexdigest()[:16],
        "name": PurePosixPath(path).stem,
        "category": path.split("/")[1],
        "difficulty": len(difficulty[1]),
        "ingredients": ingredient_terms(pieces[2]),
        "sourceUrl": f"{SOURCE}/blob/{COMMIT}/{quote(path)}",
        "sections": sections,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="HowToCook archive downloaded from codeload.github.com")
    args = parser.parse_args()
    archive_bytes = args.archive.read_bytes()
    if hashlib.sha256(archive_bytes).hexdigest() != ARCHIVE_SHA256:
        raise SystemExit("Archive does not match the pinned SHA-256.")

    recipes = []
    counts = dict.fromkeys(CATEGORY_COUNTS, 0)
    prefix = f"HowToCook-{COMMIT}/"
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as archive:
        license_text = archive.extractfile(prefix + "LICENSE").read()
        for member in archive:
            if not member.isfile() or not member.name.startswith(prefix):
                continue
            path = member.name[len(prefix):]
            parts = path.split("/")
            if len(parts) < 3 or parts[0] != "dishes" or parts[1] not in counts or not path.endswith(".md"):
                continue
            document = archive.extractfile(member).read().decode("utf-8-sig").replace("\r\n", "\n")
            recipes.append((path, parse_recipe(path, document)))
            counts[parts[1]] += 1
    if counts != CATEGORY_COUNTS or len({recipe["id"] for _, recipe in recipes}) != len(recipes):
        raise SystemExit(f"Unexpected recipe counts or duplicate IDs: {counts}")

    root = Path(__file__).resolve().parents[1]
    entries = [json.dumps(recipe, ensure_ascii=False, separators=(",", ":")) for _, recipe in sorted(recipes)]
    (root / "src/cooking/catalog-data.json").write_text("[\n" + ",\n".join(entries) + "\n]\n", encoding="utf-8")
    (root / "third-party/howtocook/LICENSE").write_bytes(license_text)


if __name__ == "__main__":
    main()
