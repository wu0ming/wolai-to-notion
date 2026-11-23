function captureWolai() {
  const blocks = new Map();
  for (const root of document.querySelectorAll('[data-area="block-root"][data-block-id]')) {
    const id = root.dataset.blockId;
    if (blocks.has(id)) continue;
    const node = [...root.querySelectorAll("[data-block-type]")].find(b=>b.dataset.blockId===id);
    if (!node) continue;
    const parent=root.parentElement.closest('[data-area="block-root"]')?.dataset.blockId || null;
    const editable=node.querySelector('[contenteditable="true"]');
    const box=node.querySelector('input[type="checkbox"],[role="checkbox"]');
    blocks.set(id, {id,parent,type:node.dataset.blockType,
      text:(editable?.innerText||node.innerText||"").trim(),
      checked:box ? box.checked ?? (box.getAttribute("aria-checked")==="true") : null,
      views:node.dataset.blockType==="database"
        ? root.innerText.split("\n").filter(s=>s.includes("视图") && s!=="视图配置") : []});
  }
  return [...blocks.values()];
}
if (typeof module!=="undefined") module.exports={captureWolai};
