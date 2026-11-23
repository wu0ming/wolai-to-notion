"use strict";

// The adapter supplies saved page content and an inventory of existing Notion files.
// This module has no network, model, or third-party dependencies.
function planPage(input) {
  const { page, source, pageIds, assets, originals = [], currentParent } = input;
  const body = page.content;
  const changes = new Map();
  const attachments = new Map();
  const exceptions = [];
  const originalRefs = new Set();
  const decode = value => { try { return decodeURIComponent(value); } catch { return value; } };
  const assetId = ref => ref.match(/^notion-file-block:\/\/[\da-f-]+\/([\da-f-]+)\?/i)?.[1];
  const tags = [...body.matchAll(/<(?:image|file|embed|audio|video|pdf)\b[^>]*source="([^"]+)"/g)];
  for (const match of tags) originalRefs.add(assetId(match[1]));
  const byBlock = new Map(assets.map(asset => [asset.block, asset]));
  function resolve(name) {
    const exact = assets.filter(asset => asset.name === name);
    if (exact.length) return exact[0];
    // The packer assigns a unique filename. Notion normalizes punctuation before the suffix.
    const suffix = name.slice(-15);
    const matches = assets.filter(asset => asset.name.endsWith(suffix));
    const names = new Set(matches.map(asset => asset.name));
    return names.size === 1 ? matches[0] : undefined;
  }
  function attach(asset) {
    const id = assetId(asset.ref);
    if (!id || originalRefs.has(id)) return;
    const alreadyNamed = tags.some(m => {
      const filename = decode(m[1].split("name=")[1] || "");
      return filename === asset.name || (filename && resolve(filename)?.name === asset.name);
    });
    if (alreadyNamed) return;
    const tag = asset.type === "image" ? "image" : "file";
    attachments.set(id, '<'+tag+' source="'+asset.ref+'"/>');
  }
  // Keep the source backlink and cross-scope links. Work on exact URLs, independent of the title.
  for (const match of body.matchAll(/\]\((https:\/\/(?:www\.)?wolai\.com\/(?:[\w-]+\/)?([A-Za-z0-9]+))\)/g)) {
    const target = pageIds[match[2]];
    if (target && match[2] !== source.id) {
      changes.set("]("+match[1]+")", "](https://app.notion.com/p/"+target+")");
    }
  }
  for (const match of body.matchAll(/(!?)\[([^\]\n]*)\]\((?:\.\/)?media\/([^\s)]+)\)/g)) {
    const name = decode(match[3]);
    const asset = resolve(name);
    if (!asset) {exceptions.push("unresolved local media: "+name);continue;}
    const label=match[2] || (match[1] ? "原图" : "原文件");
    changes.set(match[0],"["+label+"](https://app.notion.com/p/"+asset.id+"#"+asset.block+")");
    attach(asset);
  }
  // Only normalize legacy inline images if the editor must reparse the page to apply a change.
  if (changes.size) for (const match of body.matchAll(/!\[([^\]\n]*)\]\((https:\/\/[^)\n]+)\)/g)) {
    changes.set(match[0],"["+(match[1]||"查看图片")+"]("+match[2]+")");
  }
  for (const match of body.matchAll(/https:\/\/app\.notion\.com\/p\/([a-f\d]{32})#([a-f\d]{32})/g)) {
    const asset = byBlock.get(match[2]);
    if (asset && asset.id === match[1]) attach(asset);
  }
  for (const filename of originals) {
    const asset=resolve(filename);
    if(asset) attach(asset); else exceptions.push("unresolved original: "+filename);
  }
  const rows = [...changes].map(([old_str,new_str])=>({old_str,new_str,replace_all_matches:true}));
  const batches = [];
  for(let i=0;i<rows.length;i+=100) batches.push(rows.slice(i,i+100));
  const wantedParent=pageIds[source.parent];
  // Wolai's Markdown export escapes punctuation in headings. Notion titles are plain text.
  const plainTitle=source.title.replace(/\\([!-/:-@\[-`{-~])/g,"$1");
  return {
    title: plainTitle !== page.title ? plainTitle : null,
    parent: currentParent && wantedParent && currentParent !== wantedParent ? wantedParent : null,
    batches, attachments:[...attachments.values()], exceptions
  };
}

async function applyPlan(plan, adapter) {
  if(plan.title !== null) await adapter.rename(plan.title);
  if(plan.parent !== null) await adapter.move(plan.parent);
  for(const batch of plan.batches) await adapter.edit(batch);
  if(plan.attachments.length) await adapter.append(plan.attachments.join("\n\n"));
}

if(typeof module !== "undefined") {
  module.exports={planPage, applyPlan};
  if(require.main===module){
    const fs=require("node:fs");
    if(!process.argv[2]) {process.stderr.write("Usage: node wolai_rules.cjs <snapshot.json>\n");process.exitCode=2;}
    else {
      const snapshot=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
      const plan=planPage(snapshot);
      console.log(JSON.stringify({rename:plan.title!==null,move:plan.parent!==null,linkEdits:plan.batches.flat().length,
        attachments:plan.attachments.length,exceptions:plan.exceptions.length}));
      if(plan.exceptions.length)process.exitCode=1;
    }
  }
}
