"""Create a native Notion ZIP from a Wolai export and its hierarchy manifest."""
import argparse
import collections
import hashlib
import json
import posixpath
import re
import shutil
from pathlib import Path, PurePosixPath
from urllib.parse import quote, unquote
from zipfile import ZIP_DEFLATED, ZipFile
from markdown_links import refs, blocks


def pack(archive, manifest, root, destination, include_references=False, recursive_references=False):
    document = json.loads(Path(manifest).read_text(encoding="utf-8-sig"))
    records = document["pages"] if isinstance(document, dict) else document
    pages = {p["wolai_id"]: p for p in records}
    if len(records) != len(pages) or root not in pages:
        raise ValueError("Duplicate source IDs or unknown root")
    children = collections.defaultdict(list)
    for sid, p in pages.items():
        children[p["parent_id"]].append(sid)
    tree, stack = set(), [root]
    while stack:
        sid = stack.pop()
        if sid in tree:
            raise ValueError("Cycle in page hierarchy")
        tree.add(sid)
        stack.extend(children[sid])
    articles, links, media, unresolved = {}, {}, {}, []
    page_paths = {p["source"]: sid for sid, p in pages.items()}
    with ZipFile(archive) as source:
        paths = set(source.namelist())
        def convert(sid):
            p = pages[sid]
            lines = source.read(p["source"]).decode("utf-8-sig").splitlines()
            found = set()
            for a, b, kind, text in reversed(list(blocks(lines))):
                if kind == "页面标题":
                    lines[a:b] = []
                    continue
                if kind == "代码块":
                    continue
                for start, end, image, label, href in reversed(list(refs(text))):
                    wolai = re.fullmatch(r"https?://(?:www\.)?wolai\.com/([A-Za-z0-9_-]+)/?(?:[?#].*)?", href)
                    if wolai and wolai[1] in pages:
                        found.add(wolai[1])
                    if re.match(r"^(?:[A-Za-z][\w+.-]*:|//|#)", href):
                        continue
                    path = posixpath.normpath(posixpath.join(posixpath.dirname(p["source"]), unquote(href)))
                    if path in page_paths:
                        dest = page_paths[path]
                        found.add(dest)
                        url = "https://www.wolai.com/" + dest
                    elif path in paths and not path.endswith("/"):
                        name = PurePosixPath(path).name
                        key = hashlib.sha256(path.encode()).hexdigest()[:16]
                        media[path] = "media/" + key + "-" + name
                        url = quote(media[path], safe="/")
                    else:
                        unresolved.append({"page":sid, "reference":href})
                        continue
                    text = text[:start] + ("!" if image else "") + "[" + label + "](" + url + ")" + text[end:]
                lines[a:b] = text.split("\n")
            articles[sid] = "\n".join(lines).strip() + "\n\n[Wolai 原页](https://www.wolai.com/" + sid + ")\n"
            links[sid] = found
        for sid in sorted(tree):
            convert(sid)
        direct = set().union(*(links[s] for s in tree)) - tree
        if include_references or recursive_references:
            pending = set(direct)
            while pending:
                current = sorted(pending - articles.keys())
                pending.clear()
                for sid in current:
                    convert(sid)
                    if recursive_references:
                        pending.update(links[sid] | set(children[sid]))
        output = Path(destination)
        if output.exists():
            raise FileExistsError(output)
        temporary = output.with_suffix(output.suffix + ".part")
        with temporary.open("xb") as stream, ZipFile(stream, "w", allowZip64=True) as dest:
            for sid, text in articles.items():
                # Only use source IDs in archive member names, including for duplicate titles.
                if not re.fullmatch(r"[A-Za-z0-9_-]+",sid):
                    raise ValueError("Invalid page ID")
                dest.writestr(sid+".md",text,compress_type=ZIP_DEFLATED)
            for origin, target in sorted(media.items()):
                with source.open(origin) as reader, dest.open(target,"w") as writer:
                    shutil.copyfileobj(reader,writer,1024*1024)
        with ZipFile(temporary) as check:
            if check.testzip() is not None:
                raise ValueError("ZIP failed CRC verification")
            for origin,target in media.items():
                original, copy = source.getinfo(origin), check.getinfo(target)
                if (original.file_size,original.CRC)!=(copy.file_size,copy.CRC):
                    raise ValueError("Changed resource: "+origin)
        temporary.replace(output)
    return {"pages":{s:{"title":pages[s]["title"],"parent":pages[s]["parent_id"],"direct_reference":s in direct} for s in articles},
            "resources":len(media),"resource_paths":media,"unresolved":unresolved}


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ("archive","manifest","root","output"):
        parser.add_argument(key)
    parser.add_argument("--include-references",action="store_true")
    parser.add_argument("--recursive-references", action="store_true",
                        help="Include linked pages, their descendants and further in-export links until all are covered")
    args=parser.parse_args()
    result=pack(args.archive,args.manifest,args.root,args.output,args.include_references,args.recursive_references)
    Path(args.output+".json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    print(len(result["pages"]),"pages;",result["resources"],"resources;",len(result["unresolved"]),"unresolved references")
