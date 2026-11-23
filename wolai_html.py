"""Convert a Wolai HTML ZIP member into Notion MCP Markdown and a source-block audit."""
import argparse
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
from zipfile import ZipFile


class Node:
    def __init__(self, tag, attrs=()):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []

    def walk(self, tag=None):
        for child in self.children:
            if isinstance(child, Node):
                if tag is None or tag == child.tag:
                    yield child
                yield from child.walk(tag)

    def first(self, tag):
        return next(self.walk(tag), None)

    def plain(self):
        return "".join(x if isinstance(x,str) else x.plain() for x in self.children)


class Tree(HTMLParser):
    void = set("area base br col embed hr img input link meta param source track wbr".split())

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]
        self.feed(source)
        self.close()

    def handle_starttag(self, tag, attrs):
        child = Node(tag, attrs)
        self.stack[-1].children.append(child)
        if tag not in self.void:
            self.stack.append(child)

    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1,0,-1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag,attrs))

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def element(tag, label, children="", attrs=""):
    return f"<{tag}{attrs}>{label}" + ("\n\n"+children if children else "") + f"</{tag}>"


def dashboard(code):
    metrics=[]
    for line in code.splitlines():
        if not line.strip():
            continue
        m=re.fullmatch(r"\s*title (.+?) num (-?\d+(?:\.\d+)?)(?: ([\w#-]+))?\s*",line)
        if m:
            metrics.append({"kind":"number","title":m[1],"value":m[2],"color":m[3]})
            continue
        m=re.fullmatch(r"\s*title (.+?) db_view_sum:([\w:-]+)\[([^\]]+)\]\s*",line)
        if not m:
            return []
        metrics.append({"kind":"sum","title":m[1],"source":m[2].split(":"),"property":m[3]})
    return metrics


class Renderer:
    def __init__(self, source, targets=None, evidence=()):
        self.article=Tree(source).root.first("article")
        if self.article is None:
            raise ValueError("No Wolai article")
        self.targets=dict(targets or {})
        self.evidence={x["id"]:x for x in evidence}
        self.issues=[]
        self.audit=[]
        self.ref_ids={x.attrs["id"] for n in self.article.walk() if "block-ref" in n.attrs.get("class","").split()
                      for x in n.walk() if "id" in x.attrs}

    def link(self,n,label):
        href=n.attrs.get("href","")
        parts=urlsplit(href)
        if parts.hostname in ("www.wolai.com","wolai.com") or not parts.scheme:
            key=parts.fragment or (parts.path.rstrip("/").rsplit("/",1)[-1] if parts.hostname else unquote(href))
            target=self.targets.get(key)
            if target:
                if isinstance(target,dict):
                    return target["markup"]
                if parts.fragment:
                    return f"[{label}](<{target}>)"
                return element("mention",label,attrs=f' url="{html.escape(target)}"')
            self.issues.append({"type":"unmapped-link","target":key})
        return f"[{label}](<{href}>)" if href else label

    def inline(self,n):
        if isinstance(n,str):
            return html.escape(n,quote=False)
        if n.tag in ("svg","input") or "marker" in n.attrs.get("class","").split():
            return ""
        s="".join(self.inline(c) for c in n.children)
        if n.tag in ("b","i","u","s","del","strong","em"):
            return element({"del":"s","strong":"b","em":"i"}.get(n.tag,n.tag),s)
        if n.tag=="code":
            fence=chr(96)*(1+max([0]+[len(m) for m in re.findall(r"\x60+",n.plain())]))
            return fence+n.plain()+fence
        if n.tag=="a":
            return self.link(n,s)
        return s

    def body(self,nodes):
        return "\n\n".join(filter(None,(self.block(n) for n in nodes)))

    def block(self,n):
        if isinstance(n,str):
            return html.escape(n.strip(),quote=False)
        sid=n.attrs.get("id","")
        result=self.render(n,sid,n.attrs.get("class","").split())
        if sid:
            self.audit.append({"id":sid,"tag":n.tag,"rendered":bool(result)})
            if sid in self.ref_ids and result:
                result=element("synced-block",result)
        return result

    def render(self,n,sid,cls):
        tag=n.tag
        if "block-ref" in cls:
            ref=next((x.attrs["id"] for x in n.walk() if "id" in x.attrs),None)
            target=self.targets.get("block:"+str(ref))
            if target:
                return f'<synced-block-reference url="{html.escape(target)}"></synced-block-reference>'
            self.issues.append({"type":"sync-reference","target":ref})
            return ""
        if isinstance(self.targets.get(sid),dict):
            return self.targets[sid]["markup"]
        if tag=="details":
            summary=next(c for c in n.children if isinstance(c,Node) and c.tag=="summary")
            heading=next((x.tag for x in summary.walk() if re.fullmatch("h[1-4]",x.tag)),"")
            return element("toggle",self.inline(summary) or "<p />",self.body(c for c in n.children if c is not summary),
                           f' heading="{heading}"' if heading else "")
        if tag in ("h1","h2","h3","h4"):
            return "#"*int(tag[1])+" "+self.inline(n)
        if tag=="hr":
            return "---"
        if tag=="blockquote":
            return element("quote",self.inline(n))
        if tag=="aside":
            icon=next((x.attrs["data-symbol"] for x in n.walk() if "data-symbol" in x.attrs),"")
            return element("callout",self.inline(n),attrs=f' icon="{html.escape(icon)}"' if icon else "")
        if "wolai-task-block" in cls:
            return ("- [x] " if "checked" in cls else "- [ ] ")+self.inline(n)
        if tag in ("ul","ol"):
            lines=[]
            for i,li in enumerate(c for c in n.children if isinstance(c,Node) and c.tag=="li"):
                nested=[c for c in li.children if isinstance(c,Node) and c.tag in ("ul","ol","details")]
                title="".join(self.inline(c) for c in li.children if c not in nested)
                lines.append((f"{i+1}. " if tag=="ol" else "- ")+title)
                lines.extend("  "+line for line in self.body(nested).splitlines())
            return "\n".join(lines)
        if "wolai-row" in cls or "wolai-col" in cls:
            grow=re.search(r"flex-grow:\s*(0?\.\d+|1)(?:\s*;|$)",n.attrs.get("style",""))
            ratio=f' ratio="{round(100*float(grow[1]),2):g}"' if grow and "wolai-col" in cls else ""
            return element("columns" if "wolai-row" in cls else "column",self.body(n.children),attrs=ratio)
        if "wolai-simple-table" in cls:
            rows=[]
            for tr in n.walk("tr"):
                cells=[c for c in tr.children if isinstance(c,Node) and c.tag in ("th","td")]
                rows.append("<tr>"+"".join(element(c.tag,self.inline(c)) for c in cells)+"</tr>")
            return element("table","\n"+"\n".join(rows)+"\n",attrs=' header-row="'+str(bool(n.first("thead"))).lower()+'"')
        if tag=="code-block":
            lang=next((x.attrs["data-lang"] for x in n.walk() if "data-lang" in x.attrs),"").lower()
            pre=n.first("pre")
            code=pre.plain() if pre else next((x.plain() for x in n.walk() if "mermaid" in x.attrs.get("class","").split()),"")
            if lang=="ybsz":
                metrics=dashboard(code)
                if metrics and all(m["kind"]=="number" for m in metrics):
                    return "\n\n".join(element("callout",html.escape(m["title"])+" · **"+m["value"]+"**") for m in metrics)
                self.issues.append({"id":sid,"type":"dashboard","metrics":metrics})
            fence=chr(96)*max(3,1+max([0]+[len(m) for m in re.findall(r"\x60+",code)]))
            return fence+{"纯文本":"plain text","ybsz":"text"}.get(lang,lang)+"\n"+code+"\n"+fence
        if "wolai-bookmark" in cls:
            return element("bookmark","",attrs=f' source="{html.escape(n.first("a").attrs["href"])}"')
        if "wolai-file-block" in cls:
            a=n.first("a")
            target=self.targets.get(unquote(a.attrs["href"]))
            if isinstance(target,dict):
                return target["markup"]
            self.issues.append({"id":sid,"type":"upload","target":a.attrs["href"]})
            return ""
        if tag in ("iframe","img") or n.first("figure"):
            item=n if tag in ("iframe","img") else n.first("img")
            media="image" if item and item.tag=="img" else "embed"
            if not item:
                for player in ("audio","video"):
                    native=n.first(player)
                    if native and native.first("source"):
                        item,media=native.first("source"),player
                        break
            if item and item.attrs.get("src"):
                url=item.attrs["src"]
                if not url.startswith(("https://","http://")):
                    if url not in self.targets:
                        self.issues.append({"id":sid,"type":"upload","target":url})
                        return ""
                    url=self.targets[url]
                return element(media,"",attrs=f' source="{html.escape(url)}"')
        annotation=n.first("annotation")
        if annotation and annotation.attrs.get("encoding")=="application/x-tex":
            return element("equation",html.escape(annotation.plain()))
        if self.evidence.get(sid,{}).get("type")=="database":
            self.issues.append({"type":"database","id":sid})
        if "wolai-progress" in cls:
            return n.plain().strip() or self.evidence.get(sid,{}).get("text","")
        if tag in ("div","span") and any(isinstance(c,Node) and ("wolai-block" in c.attrs.get("class","").split() or c.tag=="iframe") for c in n.children):
            return self.body(n.children)
        return self.inline(n).strip()

    def recover_omissions(self):
        nodes=[n for n in self.article.children if isinstance(n,Node)]
        items=list(self.evidence.values())
        for i,item in enumerate(items):
            sid,kind=item["id"],item["type"]
            if kind in ("toggleTodoList","toggleTodoListPro"):
                hits=[n for n in nodes if n.tag=="span" and n.plain()==item["text"]]
                if len(hits)==1 and sum(x.get("text")==item["text"] for x in items)==1:
                    n=hits[0]
                    n.attrs["id"]=sid
                    label=self.inline(n)
                    checked=item.get("checked")
                    box="- [x] " if checked else "- [ ] "
                    self.targets.setdefault(sid,{"markup":element("toggle",label,box+label if checked is not None else "")})
                    self.issues.append({"id":sid,"type":"toggle-task-equivalent","checked":checked})
            elif kind=="toc" and not item.get("parent"):
                anchors={n.attrs.get("id"):n for n in nodes if n.attrs.get("id")}
                before=next((anchors[x["id"]] for x in reversed(items[:i]) if x["id"] in anchors),None)
                after=next((anchors[x["id"]] for x in items[i+1:] if x["id"] in anchors),None)
                if before and after and self.article.children.index(before)<self.article.children.index(after):
                    self.article.children.insert(self.article.children.index(after),Node("div",[("id",sid)]))
                    self.targets.setdefault(sid,{"markup":"<table-of-contents />"})

    def convert(self):
        self.recover_omissions()
        body=self.body(self.article.children)
        exported={n.attrs.get("id") for n in self.article.walk()}
        for sid,item in self.evidence.items():
            if sid not in exported:
                self.issues.append({"id":sid,"type":"missing-export-block","source_type":item["type"]})
        return {"content":body,"blocks":self.audit,"issues":self.issues}


if __name__=="__main__":
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument("archive",type=Path)
    cli.add_argument("member",help="Exact HTML path within the ZIP")
    cli.add_argument("output",type=Path)
    cli.add_argument("--targets",type=Path)
    cli.add_argument("--evidence",type=Path)
    args=cli.parse_args()
    def read(path,default):
        return json.loads(path.read_text(encoding="utf8")) if path else default
    with ZipFile(args.archive) as archive:
        renderer=Renderer(archive.read(args.member).decode("utf-8-sig"),read(args.targets,{}),read(args.evidence,[]))
    args.output.write_text(json.dumps(renderer.convert(),ensure_ascii=False,indent=2),encoding="utf8")
