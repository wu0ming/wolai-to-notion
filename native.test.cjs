"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {nativeLinks,promoteChildNavigation,taskTable,taskProperties}=require("./enn_native.cjs");
const {materializeTasks,verifyTasks}=require("./task_database.cjs");
const id="a".repeat(32),url="https://app.notion.com/p/"+id;
const fixture="| 事项 | 进度 | 勾选 | 创建时间 | 距离创建 | 最后编辑时间 | 标签 |\n|---|---|---|---|---|---|---|\n| [项目]("+url+") | ▒ 25% | ☑ | 2023/01/10 12:30 | 10天 | 2023/01/12 13:00 | |";
test("cross-tree reference becomes a native destination while source backlinks survive",()=>{
 const text="[关联](https://www.wolai.com/source123)\n[Wolai 原页](https://www.wolai.com/source123)";
 const edits=nativeLinks(text,{source123:id});
 assert.equal(edits.length,1);assert.match(edits[0].new_str,/<mention url=/);
});
test("native child block takes the navigation position and appears only once",()=>{
 const tag='<page url="'+url+'">\n示例\n</page>';
 const input='<mention url="'+url+'">示例</mention>\n说明\n'+tag;
 const out=promoteChildNavigation(input);
 assert.ok(out.startsWith(tag));assert.equal(out.split(tag).length,2);assert.equal(promoteChildNavigation(out),out);
});
test("progress and checkbox are separate; source datetime is preserved",()=>{
 const [e]=taskTable(fixture).entries;
 assert.equal(e.progress,0.25);assert.equal(e.checked,true);assert.equal(taskProperties(e)["date:创建时间:start"],"2023-01-10T12:30:00+08:00");
});
test("a filter or row mismatch prevents removal of the source table",async()=>{
 let removed=false;
 const adapter={ensureDatabase:async()=>id,ensureRow:async()=>id,setProperties:async()=>{},
 readBack:async()=>({rows:[],membership:{"全部":new Set(),"已完成":new Set(),"未完成":new Set()}}),
 removeExactTable:async()=>{removed=true;}};
 await assert.rejects(materializeTasks(fixture,adapter),/read-back/);assert.equal(removed,false);
});
test("verify the actual view that contains a checked row",()=>{
 const [e]=taskTable(fixture).entries,views={"全部":new Set([id]),"已完成":new Set([id]),"未完成":new Set()};
 assert.deepEqual(verifyTasks([e],[{...e,id}],views,{[url]:id}),[]);
 views["未完成"].add(id);assert.deepEqual(verifyTasks([e],[{...e,id}],views,{[url]:id}),["view membership"]);
});
