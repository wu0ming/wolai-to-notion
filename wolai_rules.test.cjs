"use strict";
const assert = require("node:assert/strict");
const {test} = require("node:test");
const {planPage,applyPlan}=require("./wolai_rules.cjs");
const id="a".repeat(32), other="b".repeat(32), stage="c".repeat(32), block="d".repeat(32);
const asset={id:stage,block,name:"logo_1234567890.png",type:"image",
  ref:"notion-file-block://aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/dddddddd-dddd-dddd-dddd-dddddddddddd?name=logo_1234567890.png"};
const input=body=>({page:{title:"原题",content:body},source:{id:"source",parent:"root",title:"原题"},
  pageIds:{source:id,root:other,A:id,B:other},assets:[asset]});
test("recover the exact source title and parent independently",()=>{
 const x=input("");x.page.title="原题.md";x.currentParent=id;
 const p=planPage(x);assert.equal(p.title,"原题");assert.equal(p.parent,other);
});
test("same-title siblings retain different destinations",()=>{
 const p=planPage(input("[同名](https://www.wolai.com/A) [同名](https://www.wolai.com/B)"));
 assert.equal(p.batches[0].length,2);assert.notEqual(p.batches[0][0].new_str,p.batches[0][1].new_str);
});
test("source backlinks and out-of-scope links survive",()=>{
 const p=planPage(input("[Wolai 原页](https://www.wolai.com/source) [外部](https://www.wolai.com/C)"));
 assert.deepEqual(p.batches,[]);
});
test("Markdown punctuation escapes in source headings do not cause endless renames",()=>{
 const x=input("");x.source.title="部门\\_计划";x.page.title="部门_计划";
 assert.equal(planPage(x).title,null);
 x.source.title="目录\\文档";x.page.title="旧题";assert.equal(planPage(x).title,"目录\\文档");
});
test("116 unique targets fit the Notion edit limit",()=>{
 const x=input("");for(let i=0;i<116;i++){x.pageIds["k"+i]=i.toString(16).padStart(32,"0");x.page.content+="[t](https://www.wolai.com/k"+i+")\n";}
 assert.deepEqual(planPage(x).batches.map(x=>x.length),[100,16]);
});
test("missing source files are reported without guessed replacements",()=>{
 const p=planPage(input("![](media/missing.png)"));assert.equal(p.exceptions.length,1);assert.equal(p.batches.length,0);
});
test("image references and files are restored once, and the next run is idle",async()=>{
 const x=input("![](media/logo_1234567890.png)\n\n![](media/logo_1234567890.png)");
 const plan=planPage(x);assert.equal(plan.attachments.length,1);
 await applyPlan(plan,{edit:async rows=>{for(const r of rows)x.page.content=x.page.content.split(r.old_str).join(r.new_str);},
 append:async text=>{x.page.content+="\n\n"+text;}});
 const second=planPage(x);assert.deepEqual(second.attachments,[]);assert.deepEqual(second.batches,[]);
});
test("multiple distinct suffix matches require an exception",()=>{
 const x=input("![](media/x_1234567890.png)");x.assets=[{...asset,name:"a_file_1234567890.png"},{...asset,name:"b_file_1234567890.png"}];
 assert.equal(planPage(x).exceptions.length,1);
});
