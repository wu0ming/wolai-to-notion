# Wolai → Notion

这套脚本用于打包 Wolai 导出文件、恢复 Notion 页面层级与原生导航，以及把导出的待办静态表还原为可筛选的数据库。转换规则不调用 LLM。当前包含本地转换工具和用于对接 Notion 的校正模块；线上授权、上传和读写由调用方提供。

## 打包

需要 Python 3.9+、Node.js 20+。均使用标准库。从仓库根目录运行：

```sh
python pack_export.py export.zip manifest.json ROOT_ID import.zip --include-references
```

manifest 可以是数组，也可以是带有 pages 数组的对象。每项提供 wolai_id、parent_id、title 和 source；source 是源 ZIP 中的 Markdown 路径。层级清单来自导出或已有的目录索引。一个页面可以被多处引用，仅凭正文链接无法判断它的唯一父级。

脚本保留根页和全部后代。可选参数把这些页面直接引用的、同一源包内的跨目录页面一并打包，跨目录扩展一层。附件按路径去重，写入后校验长度和 CRC。未解析的目标记入本地 import.zip.json。

若希望关联文章里的链接也能在 Notion 打开，使用 `--recursive-references`。它沿正文引用和子页面目录递归，遇到已处理的页面就跳过。链接密集的笔记可能因此带入较多页面。目标父页也在迁移范围内时，按清单恢复父级。

## 导入后校正

1. 将 ZIP 上传至目标私人空间。用每页末尾的 Wolai 原页标记建立源 ID 到目标 ID 的映射。中间文件名使用源 ID，恢复标题时从清单读取原题。
2. 用 wolai_rules.cjs 计划标题、父级、链接和原件的修复。applyPlan 需要调用方提供 rename、move、edit、append。保存映射和批次结果，重试前先读回页面。
3. enn_native.cjs 将映射成功的页面链接改成原生页面提及；首页导航若指向已有子页面，可以把相应的子页面块放到导航位置。脚本检查前后子页面 ID 集合，避免复制或遗漏。页面锚点、网址、源页回链应单独处理。
4. task_database.cjs 识别「事项／进度／勾选／创建时间／距离创建／最后编辑时间／标签」七列表。materializeTasks 接受数据库适配器；保留直接子任务原有页面 ID，跨父级任务可以建立含原页提及的记录。勾选值与进度分别映射，历史时间按导出使用的 UTC+8 解释。其他时区需调整 taskTable 的时间处理。
5. 数据库使用未完成、已完成、全部三个表格视图。核对每行的属性和所在视图之后，才会移除匹配的静态表。迁移验收还应在登录的浏览器里点击导航，并做一次可恢复的勾选测试。

## 验证

已有正文里的待补附件可用 `restore_media.cjs` 回填。输入包括正式页正文、同一源页从同一 ZIP 导入后的临时正文，以及按源文顺序排列的附件清单（每项含 image、name 和可选 label）。脚本检查占位文字、类型、扩展名和数量，并保留图片说明。写回后用 `verifyMedia` 核对文件 ID 和顺序，再通过 Notion 检查附件下载地址。临时页中 Notion 生成的文件名可能已改变，务必用同一来源的临时页配对。

```sh
python -m unittest -v test_pack
node --test wolai_rules.test.cjs native.test.cjs restore_media.test.cjs
```

测试使用虚构的页面、ID 和文件。请将真实导出、附件、页面映射和账户凭据保留在本地。数据库适配器接口和过滤配置见 task_database.cjs。
