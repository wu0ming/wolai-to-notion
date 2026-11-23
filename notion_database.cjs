"use strict";

// Use the Notion MCP fetch and mutation tools through an injected adapter.
// Stores no credentials. The caller owns the durable source-ID map and database.
function id(url) {
  const value = String(url).match(/[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i);
  if (!value) throw Error("Missing Notion UUID");
  return value[0].replaceAll("-", "").toLowerCase();
}

function content(page) {
  return page.text.match(/<content>\n([\s\S]*?)\n<\/content>/)?.[1] || "";
}

function props(page) {
  return JSON.parse(page.text.match(/<properties>\s*([\s\S]*?)\s*<\/properties>/)[1]);
}

function fieldValues(record, types) {
  const result = {};
  for (const [name, raw] of Object.entries(record.values)) {
    const kind = types[name];
    switch (kind) {
      case "date": {
        if (!raw) break;
        const dates = raw.split(" → ").map(s => s.replaceAll("/", "-"));
        if (dates.length > 2 || !dates.every(s => /^\d{4}-\d\d-\d\d$/.test(s)))
          throw Error("Unresolved date: " + raw);
        result["date:" + name + ":start"] = dates[0];
        result["date:" + name + ":is_datetime"] = 0;
        if (dates[1]) result["date:" + name + ":end"] = dates[1];
        break;
      }
      case "number":
        if (raw !== "" && !/^-?\d+(?:\.\d+)?$/.test(raw)) throw Error("Unresolved number: " + raw);
        result[name] = raw === "" ? null : Number(raw);
        break;
      case "checkbox":
        if (raw==="") break;
        if (!["☐","☑"].includes(raw)) throw Error("Unresolved checkbox: " + raw);
        result[name] = raw === "☑" ? "__YES__" : "__NO__";
        break;
      case "multi_select":
        // Multi-valued fields require explicit source option boundaries.
        result[name] = Array.isArray(raw) ? raw : raw ? [raw] : [];
        break;
      case "url": {
        const match=raw.match(/^\[.*?\]\(<?(https?:\/\/[^\s>]+?)>?(?:\s+"[^"]*")?\)$/);
        const url=match ? match[1] : raw;
        if (url && !/^https?:\/\//.test(url)) throw Error("Unresolved URL: "+raw);
        result[name]=url || null;
        break;
      }
      case "text":
      case "select":
        result[name] = raw || null;
        break;
      default:
        throw Error("Missing field mapping for " + name);
    }
  }
  return result;
}

function sameProperty(value, expected) {
  if (Array.isArray(expected)) {
    const list = typeof value === "string" ? JSON.parse(value) : value || [];
    return Array.isArray(list) && JSON.stringify([...list].sort()) === JSON.stringify([...expected].sort());
  }
  if (expected == null) return value == null || value === "";
  return value === expected;
}

function rowPrefix(body, values) {
  const prefix = body.match(/^\|[^\n]*(?:\n\|[^\n]*)*/)?.[0];
  if (!prefix) return null;
  const pairs = prefix.split("\n").map(line => line.slice(1, -1).split(/(?<!\\)\|/).map(c=>c.trim().replaceAll("\\|", "|")));
  if (pairs[1]?.length !== 2 || !pairs[1].every(c=>/^:?-+:?$/.test(c))) return null;
  pairs.splice(1, 1);
  const names = new Set(pairs.map(r=>r[0]));
  if (pairs.length !== names.size || names.size !== Object.keys(values).length) return null;
  return pairs.every(([key, val, ...rest]) => !rest.length && Object.hasOwn(values, key) && values[key] === val) ? prefix : null;
}


function matchRows(table, pageBody, expectedUrls) {
  const groups = (pageBody.match(/^[ \t]*\|[^\n]*(?:\n[ \t]*\|[^\n]*)*/gm) || [])
    .map(original => ({original, lines: original.split("\n")}));
  const marker = "<br />\\| " + table.fields[0] + " \\|";
  for (const line of pageBody.split("\n")) {
    const start = line.indexOf(marker);
    if (start < 0) continue;
    const original = line.slice(start + "<br />".length);
    groups.push({original, lines: original.split(/<br \/>(?=\\\|)/).map(s => s.replaceAll("\\|","|"))});
  }
  const matches = [];
  for (const {original, lines} of groups) {
    const cells = s => s.trim().slice(1,-1).split(/(?<!\\)\|/).map(c=>c.trim());
    if (lines.length !== table.records.length+2 || JSON.stringify(cells(lines[0])) !== JSON.stringify(table.fields)) continue;
    const column = table.title_column ?? 0;
    const urls = lines.slice(2).map(line=>cells(line)[column]?.match(/^<mention url="([^"]+)">[^<]*<\/mention>$/)?.[1]);
    if (!urls.every(Boolean) || new Set(urls.map(id)).size !== urls.length) continue;
    if (expectedUrls && (expectedUrls.length!==urls.length || !expectedUrls.every((url,i)=>id(url)===id(urls[i])))) continue;
    matches.push({original, urls});
  }
  if (matches.length!==1) throw Error("Resolve the record IDs before changing this table; matching tables: "+matches.length);
  return matches[0];
}

async function populate(api, plan) {
  const {rows, title, ds, types} = plan;
  const checked = new Map();
  for (const row of rows) {
    if (checked.has(row.id)) throw Error("Duplicate source ID " + row.id);
    const source = await api.sourcePage(row);
    if (!source.text.includes("[Wolai 原页](https://www.wolai.com/" + row.id + ")")) throw Error("Source marker mismatch: " + row.id);
    checked.set(row.id, fieldValues(row,types));
  }
  const existing = await api.readRows(ds);
  const toMove=rows.filter(r=>r.owned && !existing.has(id(r.url)));
  for(let start=0;start<toMove.length;start+=100) await api.move(toMove.slice(start,start+100).map(r=>id(r.url)),ds);
  const targetIds={};
  for(let start=0;start<rows.length;start+=4){
    const batch=await Promise.allSettled(rows.slice(start,start+4).map(async row=>{
      const key=row.owned ? id(row.url) : await api.ensureReference(ds,row,title);
      const values=checked.get(row.id);
      const current=existing.get(key);
      if (!current || !Object.entries(values).every(([k,v])=>sameProperty(current[k],v))) await api.set(key,values);
      return [row.id,key];
    }));
    const failed=batch.find(r=>r.status==="rejected");
    if(failed)throw failed.reason;
    for(const item of batch)targetIds[item.value[0]]=item.value[1];
  }
  const saved=await api.readRows(ds);
  for(const row of rows){
    const actual=saved.get(targetIds[row.id]), expected=checked.get(row.id);
    if (!actual || actual[title]!==row.targetTitle || !Object.entries(expected).every(([k,v])=>sameProperty(actual[k],v))) throw Error("Read-back differs for "+row.id);
  }
  return targetIds;
}

module.exports={id,content,props,fieldValues,sameProperty,rowPrefix,matchRows,populate};
