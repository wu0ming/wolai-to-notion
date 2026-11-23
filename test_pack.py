import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from pack_export import pack

class PackTests(unittest.TestCase):
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
