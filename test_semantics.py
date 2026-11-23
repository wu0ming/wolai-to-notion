import unittest
from export_tables import tables, property_prefix
from wolai_html import Renderer, dashboard


class Semantics(unittest.TestCase):
    def test_identical_titles_and_nonleading_record_column(self):
        text = "#### Samples\n| Fee | Company |\n| -- | -- |\n" + "".join(
            f"| {v} | [A](A_{k*22}.md) |\n" for k,v in [("a",""),("b","0")])
        t, = tables(text)
        self.assertEqual(t["title_column"],1)
        self.assertEqual([r["values"]["Fee"] for r in t["records"]],["","0"])
        self.assertEqual(len({r["id"] for r in t["records"]}),2)
        s, = tables("<!-- wolai-table:{} -->\n"+text[text.index("|"):])
        self.assertEqual(s["role"],"simple")
        self.assertEqual(list(tables("~~~\n"+text+"~~~")),[])

    def test_duplicate_properties(self):
        source = "# A\n\n| Tag | X |\n| - | - |\n| Fee | 0 |\n\nbody"
        self.assertIsNotNone(property_prefix(source,["Tag","Fee"],{"Fee":"0","Tag":"X"}))
        self.assertIsNone(property_prefix(source,["Tag","Fee"],{"Fee":"","Tag":"X"}))

    def test_nested_heading_keeps_only_its_own_table(self):
        s = '<article><details><summary><h4>A</h4></summary><div class="wolai-simple-table"><table><tr><td>0</td></tr></table></div></details><h4>B</h4></article>'
        output=Renderer(s).convert()["content"]
        self.assertIn('<toggle heading="h4">A',output)
        self.assertIn('<td>0</td>',output)
        self.assertTrue(output.endswith("</toggle>\n\n#### B"))

    def test_dynamic_metric_is_not_a_static_number(self):
        self.assertEqual(dashboard("title Zero num 0 red")[0]["value"],"0")
        metric=dashboard("title Total db_view_sum:source:view:field[Amount]")[0]
        self.assertEqual(metric["source"],["source","view","field"])
        self.assertEqual(dashboard("title Unsupported something"),[])

    def test_block_anchor_and_sync_reference_are_distinct(self):
        s='<article><div id="x">original</div><div class="block-ref"><div id="x">original</div></div><a href="other.html#x">anchor</a></article>'
        output=Renderer(s,{"block:x":"https://example.com/p#x","x":"https://example.com/p#x"}).convert()["content"]
        self.assertIn('<synced-block-reference url=',output)
        self.assertIn('[anchor](<https://example.com/p#x>)',output)
