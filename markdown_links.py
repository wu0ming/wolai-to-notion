import html
import re

TITLE = re.compile(r"^#\s+(.+)$")
FENCE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")
DIVIDER = re.compile(r"^([*_-])(?:\s*\1){2,}\s*$")
LINK = re.compile(r"(!?)\[((?:\\.|[^\[\]\\]|\[[^\[\]\n]*\])*)\]\(")
UNESCAPE = re.compile(r"\\([!()*\[\]&_#<>~.+\-])")


def refs(s):
    for m in LINK.finditer(s):
        start = m.end()
        depth = 1
        escape = False
        for i in range(start, len(s)):
            c = s[i]
            if escape:
                escape = False
                continue
            if c == "\\":
                escape = True
            elif c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if not depth:
                    break
        else:
            continue
        raw = s[start:i].strip()
        dest = re.sub(r"""\s+(?:"[^"]*"|'[^']*')\s*$""", "", raw, flags=re.S).strip()
        if dest.startswith("<") and dest.endswith(">"):
            dest = dest[1:-1]
        dest = html.unescape(UNESCAPE.sub(r"\1", dest))
        yield m.start(), i + 1, bool(m[1]), m[2], dest


def line_kind(line):
    s = line.strip()
    if FENCE.match(line):
        return "代码块"
    if not s:
        return ""
    if s.startswith("|") or s.startswith(r"\|"):
        return "表格行"
    if re.match(r"^[-+*]\s+\[[ xX]\](?:\s|$)", s):
        return "待办｜已勾选" if re.match(r"^[-+*]\s+\[[xX]\]",s) else "待办｜未勾选"
    if DIVIDER.fullmatch(s):
        return "分隔线"
    if re.match(r"^[-+*]\s+",s):
        return "无序列表项"
    if re.match(r"^\d+[.)]\s+",s):
        return "有序列表项"
    if re.match(r"^#{1,6}\s+",s):
        return "正文标题 " + str(len(s.split()[0]))
    if s.startswith(">"):
        return "引用"
    if re.match(r"^\[\^[^\]]+\]:",s):
        return "脚注定义"
    if s.startswith("!["):
        return "图片或混合块"
    if s.startswith("** ") and s.endswith("**"):
        return "疑似底色文本"
    if s.startswith("$$"):
        return "公式标记"
    if re.match(r"^</?[a-zA-Z]+[\s/>]",s) and not s.startswith("<br"):
        return "HTML 或嵌入"
    if re.match(r"^\[[^\]]*\]\(",s) and any(end == len(s) for _,end,*_ in refs(s)):
        return "独立链接"
    return "段落"


def blocks(lines):
    i = 0
    title_line = next((n for n, l in enumerate(lines) if l.strip()), -1)
    while i < len(lines):
        a = i
        l = lines[i]
        k = line_kind(l)
        i += 1
        if not k:
            continue
        if a == title_line and TITLE.match(l):
            k = "页面标题"
        elif k == "代码块":
            opening = FENCE.match(l)[1]
            while i < len(lines):
                end = re.fullmatch(rf"\s*{opening[0]}{{{len(opening)},}}\s*",lines[i])
                i += 1
                if end:
                    break
        elif k in ("段落", "引用"):
            while i < len(lines) and line_kind(lines[i]) == k:
                i += 1
        elif k in ("无序列表项","有序列表项","待办｜已勾选","待办｜未勾选"):
            indent = len(l) - len(l.lstrip())
            while i < len(lines) and line_kind(lines[i]) == "段落" and len(lines[i]) - len(lines[i].lstrip()) > indent:
                i += 1
        yield a, i, k, "\n".join(lines[a:i])
