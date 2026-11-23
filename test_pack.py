import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from pack_export import pack

class PackTests(unittest.TestCase):
    def test_recursive_mode_follows_children_and_links_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            parents = {"root":None, "linked":None, "child":"linked", "extra":None, "unrelated":None}
            texts = {"root":"[link](linked.md)", "linked":"body", "child":"[outside](https://www.wolai.com/extra)",
                     "extra":"[cycle](root.md)", "unrelated":"other"}
            manifest = [{"wolai_id":s, "source":s+".md", "title":s, "parent_id":p} for s,p in parents.items()]
            (base/"manifest").write_text(json.dumps(manifest), encoding="utf8")
            with ZipFile(base/"source.zip", "w") as z:
                for sid, text in texts.items():
                    z.writestr(sid+".md", "# "+sid+"\n\n"+text)
            def run(name, **kwargs):
                return pack(base/"source.zip", base/"manifest", "root", base/name, **kwargs)["pages"]
            self.assertEqual(set(run("direct.zip", include_references=True)), {"root","linked"})
            pages = run("recursive.zip", recursive_references=True)
            self.assertEqual(set(pages), {"root","linked","child","extra"})
            self.assertEqual(pages["child"]["parent"], "linked")
            self.assertFalse(pages["extra"]["direct_reference"])

    def test_scope_and_original_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)
            manifest=[{"wolai_id":s,"title":"示例","source":"pages/"+s+".md","parent_id":p}
                      for s,p in [("A",None),("B","A"),("C",None)]]
            m=base/"manifest.json"
            m.write_text(json.dumps(manifest),encoding="utf8")
            with ZipFile(base/"source.zip","w") as z:
                z.writestr("pages/A.md","# 示例\n[同级之外](C.md)\n![](../image/sample.png)\n[找不到](missing.md)")
                z.writestr("pages/B.md","# 示例\n\n```md\n[代码](C.md)\n```")
                z.writestr("pages/C.md","# 示例\n外部引用目标")
                z.writestr("image/sample.png",bytes(range(128)))
            result=pack(base/"source.zip",m,"A",base/"out.zip",True)
            self.assertEqual(set(result["pages"]),{"A","B","C"})
            self.assertTrue(result["pages"]["C"]["direct_reference"])
            self.assertEqual(len(result["unresolved"]),1)
            with ZipFile(base/"out.zip") as z:
                self.assertEqual(z.read(result["resource_paths"]["image/sample.png"]),bytes(range(128)))
                self.assertIn("[代码](C.md)",z.read("B.md").decode())
                self.assertIn("https://www.wolai.com/C",z.read("A.md").decode())
            with self.assertRaises(FileExistsError):
                pack(base/"source.zip",m,"A",base/"out.zip")

if __name__=="__main__":
    unittest.main()
