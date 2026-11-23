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

test("Notion rich text and exported carriage returns compare semantically",()=>{
  const {sameProperty}=require("./notion_database.cjs");
  assert.ok(sameProperty("A<i><b>B</b></i>", "A***B***&#xD;"));
  assert.equal(sameProperty("A","B"),false);
});
test("the database sum retains its verified filter",()=>{
  const {numberView}=require("./notion_database.cjs");
  assert.equal(numberView({kind:"sum",title:"Y",property:"Cost"},'FILTER "Year" = "2024"').configure,
    'FILTER "Year" = "2024"; CHART number AGGREGATE sum ON "Cost"');
});

test("compact HTML whitespace only in rendered property prose", () => {
  const {rowPrefix} = require("./notion_database.cjs");
  const table = "| Note | One <i><b>two</b></i> |\n| --- | --- |";
  assert.equal(rowPrefix(table, {Note: "One  ***two***"}), table);
  const code = "| Note | `a b` |\n| --- | --- |";
  assert.equal(rowPrefix(code, {Note: "`a  b`"}), null);
  assert.equal(rowPrefix(table, {Note: "One  three"}), null);
});

test("normalize exported URL fields without swallowing informative tooltips", () => {
  const {fieldValues, sameProperty} = require("./notion_database.cjs");
  const convert = s => fieldValues({values:{Link:s}}, {Link:"text"}).Link;
  assert.equal(convert('[Label](https://example.org "https://example.org")'), '[Label](https://example.org)');
  assert.equal(convert('[Words only](<Words only> "Words only")'), 'Words only');
  const urls = "https://example.org/a  https://example.org/b";
  assert.equal(convert("[" + urls + "](<" + urls + '> "' + urls + '")'),
    "[https://example.org/a](https://example.org/a) [https://example.org/b](https://example.org/b)");
  assert.equal(convert('[Label](https://example.org "tooltip with extra detail")'), '[Label](https://example.org "tooltip with extra detail")');
  assert.equal(sameProperty("A&B<br />C", "A\\&B&#xA;C"), true);
});
