"use strict";
function taskTable(text) {
  const lines=text.split(/\r?\n/);
  const fields=["事项","进度","勾选","创建时间","距离创建","最后编辑时间","标签"];
  const cells=line=>line.trim().slice(1,-1).split(/(?<!\\)\|/).map(c=>c.trim());
  const start=lines.findIndex(line=>line.startsWith("|")&&JSON.stringify(cells(line))===JSON.stringify(fields));
  if(start<0)return null;
  let end=start+2;
  const entries=[];
  while(end<lines.length&&lines[end].startsWith("|")){
    const row=cells(lines[end++]);
    const link=row[0].match(/^\[(.+)\]\((.+)\)$/),pct=row[1].match(/(\d+)%$/);
    if(row.length!==7||!link||!pct||!["☑","☐"].includes(row[2]))throw Error("Unrecognized task record");
    const stamp=s=>s?s.replaceAll("/","-").replace(" ","T")+(s.includes(" ")?":00+08:00":""):null;
    entries.push({title:link[1],target:link[2],progress:Number(pct[1])/100,checked:row[2]==="☑",created:stamp(row[3]),edited:stamp(row[5]),tags:row[6]});
  }
  return {block:lines.slice(start,end).join("\n"),entries};
}
function nativeLinks(text,pageMap) {
  const edits=new Map();
  // Convert rich-text page references, including those inside table cells.
  let fence=null;
  const protectedText=[];
  for(const line of text.split("\n")){
    const f=line.trim().match(/^(`{3,}|~{3,})/);if(f){if(!fence)fence=f[1];else if(f[1]===fence)fence=null;continue;}
    if(fence){protectedText.push(line);continue;}
    const inline=line.replace(/(`+)[\s\S]*?\1/g,s=>{protectedText.push(s);return "";});
    for(const m of inline.matchAll(/(?<!!)\[([^\]\n]+)\]\(https:\/\/(?:app\.notion\.com\/p\/([a-f0-9]{32})|www\.wolai\.com\/([A-Za-z0-9]+))\)/g)){
    if(m[1]==="Wolai 原页")continue;
    const id=m[2]||pageMap[m[3]];if(!id)continue;
    const label=m[1].replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
    edits.set(m[0],{old_str:m[0],new_str:'<mention url="https://app.notion.com/p/'+id+'">'+label+'</mention>',replace_all_matches:true});
    }
  }
  return [...edits.values()].filter(edit=>!protectedText.some(s=>s.includes(edit.old_str)));
}
function promoteChildNavigation(body) {
  const pageTag=/<page url="https:\/\/app\.notion\.com\/p\/([a-f0-9]{32})">\n[^\n]+\n<\/page>/g;
  const children=new Map([...body.matchAll(pageTag)].map(m=>[m[1],m[0]]));
  const used=new Set();
  const promoted=body.replace(/^<mention url="https:\/\/app\.notion\.com\/p\/([a-f0-9]{32})">[^\n]*?<\/mention>$/gm,(mention,id)=>{
    if(!children.has(id)||used.has(id))return mention;
    used.add(id);
    return "\u0001"+id+"\u0001";
  });
  if(!used.size)return body;
  const out=promoted.replace(pageTag,(tag,id)=>used.has(id)?"":tag)
    .replace(/\u0001([a-f0-9]{32})\u0001/g,(_,id)=>children.get(id));
  const inventory=s=>[...s.matchAll(pageTag)].map(m=>m[1]).sort().join(",");
  if(inventory(out)!==inventory(body))throw Error("Child inventory changed");
  return out;
}
function taskProperties(row){
  const p={"进度":row.progress,"勾选":row.checked?"__YES__":"__NO__"};
  for(const [key,value] of [["创建时间",row.created],["最后编辑时间",row.edited]]){
    if(value){p["date:"+key+":start"]=value;p["date:"+key+":is_datetime"]=value.includes("T")?1:0;}
  }
  if(row.tags)p["标签"]=JSON.stringify(row.tags.split(/[,，]/).map(x=>x.trim()).filter(Boolean));
  return p;
}
if(typeof module!=="undefined")module.exports={taskTable,nativeLinks,promoteChildNavigation,taskProperties};
