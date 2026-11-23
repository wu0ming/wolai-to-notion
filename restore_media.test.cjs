"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { restoreMedia, verifyMedia } = require("./restore_media.cjs");
const entries = [{image:true,name:"a_b.png"}, {image:false,name:"research.pdf",label:"A & B"}];
const first = '<image source="notion-file-block://block1/file1?name=file1.png">图注</image>';
const second = '<file source="notion-file-block://block2/file2?name=file2.pdf" />';
const stage = first + "\n\n" + second;
const original = "标题\n  <p>\n  〔待补原图：a\\_b.png〕\n  </p>\n\n〔待补原文件：A & B〕";

test("restore captions, remove only placeholder wrappers, and accept an identical retry", () => {
  const {body, ids} = restoreMedia(original, stage, entries);
  assert.equal(body, "标题\n  " + first + "\n\n" + second.replace(" />", ">A &amp; B</file>"));
  assert.equal(restoreMedia(body, stage, entries).body, body);
  assert.ok(verifyMedia(body.replace("block1", "newblock"), ids));
  assert.equal(verifyMedia(body.replace("file1?", "wrong?"), ids), false);
});
test("reject changed order, missing markers or a different file extension", () => {
  assert.throws(() => restoreMedia(original, second + "\n" + first, entries));
  assert.throws(() => restoreMedia(original.split("\n\n")[0], stage, entries));
  assert.throws(() => restoreMedia(original, stage.replace(".png", ".jpg"), entries));
});
