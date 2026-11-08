"""Reference counts from docutils (development and gate only; the extension never runs Python).

usage: python3 -E scripts/ref_rst.py <file.rst> [--html out.html]
Prints JSON: element counts of the docutils doctree and its system messages (line, level, text).
Sphinx-only directives and roles are registered as no-op stand-ins, so the counts compare the docutils core.
"""
import json
import sys

from docutils import nodes
from docutils.core import publish_doctree, publish_from_doctree
from docutils.parsers.rst import Directive, directives, roles


class Box(Directive):
    has_content = True
    optional_arguments = 10
    final_argument_whitespace = True
    option_spec = None

    def run(self):
        return []


class AnyOptions(dict):
    def __getitem__(self, k):
        return directives.unchanged

    def __contains__(self, k):
        return True


Box.option_spec = AnyOptions()
SPHINX = ("toctree automodule autoclass autofunction automethod autoattribute autodata autoexception autosummary versionadded "
          "versionchanged deprecated seealso glossary productionlist index only literalinclude code-block sourcecode highlight "
          "function class method attribute data exception module currentmodule note-sphinx centered hlist tabularcolumns "
          "py:function py:class py:method py:attribute py:data py:module py:exception console todo").split()
for name in SPHINX:
    if name in ("code-block", "sourcecode"):
        continue
    directives.register_directive(name, Box)


def any_role(name, rawtext, text, lineno, inliner, options=None, content=None):
    return [nodes.literal(rawtext, text)], []


for r in "ref doc func meth class mod attr data exc obj const term envvar option program file samp kbd menuselection guilabel py:func py:class py:meth py:mod py:attr py:data py:exc py:obj c:func c:macro duref dudir confval cli".split():
    roles.register_local_role(r, any_role)


def main():
    path = sys.argv[1]
    src = open(path, encoding="utf-8", errors="replace").read()
    settings = {"report_level": 1, "halt_level": 5, "warning_stream": False, "input_encoding": "utf-8",
                "file_insertion_enabled": False, "raw_enabled": True, "doctitle_xform": False, "sectsubtitle_xform": False}
    doc = publish_doctree(src, source_path=path, settings_overrides=settings)
    counts = {}
    def inside_msg(n):
        while n is not None:
            if isinstance(n, (nodes.system_message, nodes.substitution_definition)):
                return True
            n = n.parent
        return False
    for n in doc.findall(nodes.Element):
        if not inside_msg(n):
            counts[n.tagname] = counts.get(n.tagname, 0) + 1
    msgs = [{"line": m.get("line"), "level": m.get("level"), "text": m.astext()[:200]} for m in doc.findall(nodes.system_message)]
    if "--html" in sys.argv:
        out = sys.argv[sys.argv.index("--html") + 1]
        html = publish_from_doctree(doc, writer_name="html5", settings_overrides={"report_level": 5, "embed_stylesheet": True})
        open(out, "wb").write(html)
    print(json.dumps({"counts": counts, "messages": msgs}))


main()
