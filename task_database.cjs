"use strict";
const {taskTable,taskProperties}=require("./enn_native.cjs");

const viewDefinitions=[
  {name:"未完成",filter:'FILTER "勾选" = false'},
  {name:"已完成",filter:'FILTER "勾选" = true'},
  {name:"全部",filter:null},
];
const propertiesDDL=[
  ['进度', 'NUMBER FORMAT \'percent\''],['勾选','CHECKBOX'],['创建时间','DATE'],
  ['距离创建','FORMULA(\'dateBetween(now(), prop("创建时间"), "days")\')'],
  ['最后编辑时间','DATE'],['标签','MULTI_SELECT'],
];

function verifyTasks(entries, saved, membership, rowIds){
  const problems=[];
  const rows=new Map(saved.map(v=>[v.id,v]));
  if(rows.size!==entries.length)problems.push("row count");
  const wanted=new Set();
  for(const e of entries){
    const id=rowIds[e.target],r=rows.get(id);
    if(!id||wanted.has(id)||!r){problems.push("row identity");continue;}
    wanted.add(id);
    if(r.title!==e.title||r.progress!==e.progress||r.checked!==e.checked) problems.push("task properties");
    for(const field of ["created","edited"])
      if((r[field]||e[field])&&Date.parse(r[field])!==Date.parse(e[field])) problems.push(field);
    if(!membership["全部"].has(id)||!membership[e.checked?"已完成":"未完成"].has(id)
        ||membership[e.checked?"未完成":"已完成"].has(id))problems.push("view membership");
  }
  return problems;
}

// The adapter owns authentication, rate limiting and durable source-ID -> row-ID storage.
// Reuse an existing inline database and migrate child pages in place to retain their URLs.
async function materializeTasks(source,adapter){
  const table=taskTable(source);
  if(!table)throw Error("Expected the exported task table");
  const database=await adapter.ensureDatabase({title:"我的待办",titleProperty:"事项",propertiesDDL,viewDefinitions});
  const rowIds={};
  for(const entry of table.entries){
    // Direct children become database rows. Cross-parent references need a row pointing to the original page.
    const id=await adapter.ensureRow(database,entry.target,entry.title);
    await adapter.setProperties(id,taskProperties(entry));
    rowIds[entry.target]=id;
  }
  const {rows,membership}=await adapter.readBack(database);
  const issues=verifyTasks(table.entries,rows,membership,rowIds);
  if(issues.length)throw Error("Notion read-back failed: "+[...new Set(issues)].join(", "));
  await adapter.removeExactTable(table.block);
  return {database,rows:rows.length};
}
module.exports={materializeTasks,verifyTasks,viewDefinitions,propertiesDDL};
