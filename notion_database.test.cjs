"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {matchRows,rowPrefix,fieldValues}=require("./notion_database.cjs");

test("refuse ambiguous tables with the same header and identical display titles",()=>{
  const uri=k=>"https://example.com/"+k.repeat(32);
  const grid=k=>'| Value | Name |\n| --- | --- |\n| 0 | <mention url="'+uri(k)+'">A</mention> |';
  const page=grid("a")+"\n\n"+grid("b");
  const table={fields:["Value","Name"],title_column:1,records:[{}]};
  assert.throws(()=>matchRows(table,page));
  assert.equal(matchRows(table,page,[uri("b")]).original,grid("b"));
});
test("remove only a complete leading copy of native properties",()=>{
  const body="| N | 0 |\n| --- | --- |\n| A |  |\n\nBody";
  assert.ok(rowPrefix(body,{N:"0",A:""}));
  assert.equal(rowPrefix(body,{N:"",A:""}),null);
  assert.equal(rowPrefix("text\n"+body,{N:"0",A:""}),null);
});
test("native zero, missing amounts and date ranges survive independently",()=>{
  const got=fieldValues({values:{A:"0",B:"",Time:"2024/01/02 → 2024/01/04"}},{A:"number",B:"number",Time:"date"});
  assert.deepEqual(got,{A:0,B:null,"date:Time:start":"2024-01-02","date:Time:is_datetime":0,"date:Time:end":"2024-01-04"});
});
