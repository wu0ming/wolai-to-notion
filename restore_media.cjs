"use strict";

// Canonical and staged pages must come from the same checked ZIP and source page.
// Notion changes a block ID when copying a file, but retains the uploaded file ID.
function hostedMedia(body) {
  const tag = /<(image|file|pdf) source="(notion-file-block:\/\/[^"]+)"(?:\s*\/>|>[\s\S]*?<\/\1>)/g;
  return [...body.matchAll(tag)].map(match => {
    const source = new URL(match[2].replaceAll("&amp;", "&"));
    return { tag: match[0], type: match[1], id: source.pathname.slice(1),
      name: source.searchParams.get("name"), source: match[2] };
  });
}

const readable = s => s.replace(/\\([!()*\[\]&_#<>~.+\-|])/g, "$1");
const escaped = s => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const extension = name => (name || "").split(".").pop().toLowerCase();

function verifyMedia(body, expectedIds) {
  const ids = hostedMedia(body).map(block => block.id);
  return !body.includes("〔待补原") && ids.length === expectedIds.length &&
    ids.every((id, index) => id === expectedIds[index]);
}

function restoreMedia(body, staging, entries) {
  const blocks = hostedMedia(staging);
  const ids = blocks.map(block => block.id);
  const lines = body.split("\n");
  const positions = lines.flatMap((line, i) => line.includes("〔待补原") ? [i] : []);
  if (blocks.length !== entries.length) throw Error("Unexpected staged attachment count");
  if (!positions.length && verifyMedia(body, ids)) return { body, ids };
  if (positions.length !== entries.length || hostedMedia(body).length) {
    throw Error("Expected a complete set of source placeholders");
  }
  for (let index = positions.length - 1; index >= 0; index--) {
    const i = positions[index], block = blocks[index], entry = entries[index];
    const label = readable(entry.label || entry.name);
    const marker = entry.image ? "图：" + entry.name : "文件：" + label;
    if (readable(lines[i].trim()) !== "〔待补原" + marker + "〕" ||
        entry.image !== (block.type === "image") || extension(entry.name) !== extension(block.name)) {
      throw Error("Unexpected attachment at source position " + (index + 1));
    }
    const tag = entry.image ? block.tag :
      '<' + block.type + ' source="' + block.source + '">' + escaped(label) + '</' + block.type + '>';
    const line = lines[i].match(/^\s*/)[0] + tag;
    if (lines[i-1]?.trim() === "<p>" && lines[i+1]?.trim() === "</p>") {
      lines.splice(i-1, 3, line);
    } else {
      lines[i] = line;
    }
  }
  const result = lines.join("\n");
  if (!verifyMedia(result, ids)) throw Error("Restored attachment order changed");
  return { body: result, ids };
}

module.exports = { hostedMedia, restoreMedia, verifyMedia };
