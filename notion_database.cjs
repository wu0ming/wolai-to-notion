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

// Wolai exports a text-valued URL field as one Markdown link, including
// prose, empty dash placeholders, and multiple URLs pasted into one cell.
function exportText(value) {
  if (typeof value !== "string") return value;
  const match = value.match(/^\[([^\]\n]*)\]\((?:<([^>]*)>|([^\s]+?))(?: "([^"]*)")?\)$/);
  if (!match) return value;
  const unescape = s => s.replace(/\\([&*_])/g, "$1");
  const [, label, angled, bare, tooltip] = match;
  const visible = unescape(label), target = unescape(angled ?? bare);
  if (tooltip !== undefined && unescape(tooltip) !== visible && unescape(tooltip) !== target) return value;
  const urls = visible.trim().split(/\s+/);
  if (urls.length > 1 && urls.every(s => /^https?:\/\/[^\s]+$/.test(s)) && visible === target)
    return urls.map(url => "[" + url + "](" + url + ")").join(" ");
  if (/^https?:\/\/[^\s]+$/.test(target)) return "[" + label + "](" + target + ")";
  if (tooltip !== undefined && unescape(tooltip) === visible && (!target || visible === target || visible.includes("\\") && target.includes("\\")))
    return visible.includes("\\") ? "\x60" + visible + "\x60" : label;
  return value;
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
        result[name] = exportText(raw) || null;
        break;
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
  if (typeof value === "string" && /^<code>[^<]*<\/code>$/.test(value) && typeof expected === "string" && /^`[^`]*`$/.test(expected))
    return value.slice(6, -7) === expected.slice(1, -1);
  if (Array.isArray(expected)) {
    const list = typeof value === "string" ? JSON.parse(value) : value || [];
    return Array.isArray(list) && JSON.stringify([...list].sort()) === JSON.stringify([...expected].sort());
  }
  if (expected == null) return value == null || value === "";
  const normalize = s=>typeof s!=="string"?(s??""):exportText(s).replace(/&#x0*[ad];|&#(?:10|13);|\r/gi,"\n").replace(/<br\s*\/?>/gi,"\n").replace(/<i><b>(.*?)<\/b><\/i>|<b><i>(.*?)<\/i><\/b>/gs,(_,x,y)=>"***"+(x??y)+"***").replace(/<b>(.*?)<\/b>/gs,"**$1**").replace(/<i>(.*?)<\/i>/gs,"*$1*").replace(/\\([&*_])/g,"$1").trim();
  return normalize(value) === normalize(expected);
}

// Imported property tables can contain a percent-encoded copy of the original
// malformed link. Only collapse it when the full destination and label agree.
function sameExportedLink(source, rendered) {
  if (typeof source !== "string" || typeof rendered !== "string") return false;
  const s = source.match(/^\[([^\]\n]*)\]\((?:<([^>]*)>|([^\s]+?)) "([^"]*)"\)$/);
  const r = rendered.match(/^\[([^\]\n]*)\]\((?:<([^>]*)>|(.+))\)$/);
  if (!s || !r) return false;
  const original = s[2] ?? s[3], target = r[2] ?? r[3];
  if (/^https?:\/\/\S+$/i.test(original)) return false;
  let decoded;
  try { decoded = decodeURIComponent(target); } catch { return false; }
  if (decoded !== original || s[4] !== s[1].replace(/\\([*_&])/g, "$1") && s[4] !== s[1]) return false;
  const compact = s => s.replace(/[ \t]+/g, " ");
  if (compact(s[1]) === compact(r[1])) return true;
  // Some legacy imports shortened the displayed UNC path while preserving its
  // full destination. Match the host and every displayed segment in order.
  if (!s[1].includes("\\\\") || !r[1].includes("\\\\")) return false;
  const all = s[1].split(/\\+/).filter(Boolean), shown = r[1].split(/\\+/).filter(Boolean);
  if (shown.length < 3 || shown[0] !== all[0] || shown[1] !== all[1]) return false;
  let index = 1;
  return shown.slice(2).every(segment => (index = all.indexOf(segment, index + 1)) >= 0);
}

function rowPrefix(body, values) {
  const prefix = body.match(/^\|[^\n]*(?:\n\|[^\n]*)*/)?.[0];
  if (!prefix) return null;
  const pairs = prefix.split("\n").map(line => line.slice(1, -1).split(/(?<!\\)\|/).map(c=>c.trim().replaceAll("\\|", "|")));
  if (pairs[1]?.length !== 2 || !pairs[1].every(c=>/^:?-+:?$/.test(c))) return null;
  pairs.splice(1, 1);
  const names = new Set(pairs.map(r=>r[0]));
  if (pairs.length !== names.size || names.size !== Object.keys(values).length) return null;
  // HTML collapses horizontal whitespace in ordinary prose. Keep code and line
  // breaks exact, and still require an exact field-name set and value match.
  const rendered = value => typeof value === "string" && !/\x60|<code\b|<pre\b/i.test(value)
    ? value.replace(/[ \t]+/g, " ") : value;
  return pairs.every(([key, val, ...rest]) =>
    !rest.length && Object.hasOwn(values, key) && (sameProperty(rendered(values[key]), rendered(val)) || sameExportedLink(values[key], val))
  ) ? prefix : null;
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


// Only edit the verified table and the existing database block. Unrelated blocks and
// concurrent changes elsewhere in the page are outside the update_content request.
async function placeNativeTable(api, pageId, tableText, databaseUrl, caption="") {
  const body=content(await api.fetch(pageId));
  const blocks=[...body.matchAll(/<database\b[^>]*>[\s\S]*?<\/database>/g)].map(m=>m[0]);
  const matching=blocks.filter(block=>id(block.match(/url="([^"]+)"/)[1])===id(databaseUrl));
  if(matching.length!==1)throw Error("Cannot identify a unique database block");
  const tag=matching[0], inline=tag.replace('inline="false"','inline="true"');
  if(!body.includes(tableText)){
    if(tag===inline)return;
    throw Error("The source table has changed");
  }
  if(body.indexOf(tableText)!==body.lastIndexOf(tableText))throw Error("Multiple matching static tables");
  const titled="#### "+caption+"\n\n"+tableText;
  const old=caption && body.includes(titled) ? titled : tableText;
  await api.updateContent(pageId,[{old_str:tag,new_str:""},{old_str:old,new_str:"\n\n"+inline+"\n\n"}]);
  const saved=content(await api.fetch(pageId));
  if(saved.includes(tableText)||!saved.includes(inline.split(">")[0]+">"))throw Error("Database placement verification failed");
}

// Caller resolves the source view IDs against the actual Wolai filters before calling.
function numberView(metric, filter) {
  if(metric.kind!=="sum"||!metric.property)throw Error("Expected a database sum");
  const quote=value=>JSON.stringify(String(value));
  const aggregation="CHART number AGGREGATE sum ON "+quote(metric.property);
  return {name:metric.title,type:"chart",configure:filter ? filter+"; "+aggregation : aggregation};
}

module.exports={id,content,props,fieldValues,sameProperty,rowPrefix,matchRows,populate,placeNativeTable,numberView};
