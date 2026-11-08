"""Side-by-side text check against docutils (dev and gate only). For each file: words of the docutils HTML body and of
RST Preview's HTML, a similarity ratio, and the biggest differences. usage: python3 -E scripts/textdiff.py <ours.json> <file.rst>...
ours.json maps file name -> HTML from RST Preview (scripts/render_all.js writes it)."""
import difflib, html, json, re, sys
from docutils.core import publish_parts

ours = json.load(open(sys.argv[1]))
def words(h):
    h = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', h, flags=re.S)
    h = re.sub(r'<span class="sectnum">[^<]*</span>', ' ', h)
    h = re.sub(r'<a class="(headerlink|fn-backref)"[^>]*>.*?</a>', ' ', h)
    t = html.unescape(re.sub(r'<[^>]+>', ' ', h))
    return re.findall(r'\w+', t)
for f in sys.argv[2:]:
    src = open(f, encoding='utf-8').read()
    du = publish_parts(src, writer_name='html5', settings_overrides={'report_level': 5, 'doctitle_xform': False, 'file_insertion_enabled': False, 'sectnum_xform': False})['html_body']
    a, b = words(du), words(ours[f.split('/')[-1]])
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    print(f"== {f.split('/')[-1]}: docutils {len(a)} words, ours {len(b)} words, same order {sm.ratio():.3f}")
    ops = [o for o in sm.get_opcodes() if o[0] != 'equal']
    ops.sort(key=lambda o: -max(o[2] - o[1], o[4] - o[3]))
    for tag, i1, i2, j1, j2 in ops[:6]:
        print(f"   {tag:7} docutils: {' '.join(a[i1:i2])[:90]!r}  ours: {' '.join(b[j1:j2])[:90]!r}")
