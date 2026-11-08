# Sample files

Real files, copied unchanged for the tests and the release gate (not part of the extension package):

| File | Source | Licence |
|---|---|---|
| docutils-demo.rst, docutils-quickstart.rst, images/title.png, images/biohazard.png | docutils 0.21.2 sdist, docs/user/rst/ | public domain |
| sphinx-basics.rst, sphinx-directives.rst, sphinx-README.rst | github.com/sphinx-doc/sphinx (doc/usage/restructuredtext, README.rst) | BSD-2-Clause |
| cpython-json.rst, cpython-tut-controlflow.rst, cpython-argparse.rst | github.com/python/cpython (Doc/) | PSF License |
| django-tutorial01.rst | github.com/django/django (docs/intro/tutorial01.txt) | BSD-3-Clause |
| flask-quickstart.rst | github.com/pallets/flask (docs/quickstart.rst) | BSD-3-Clause |
| numpy-absolute-beginners.rst | github.com/numpy/numpy (doc/source/user/absolute_beginners.rst) | BSD-3-Clause |
| requests-quickstart.rst | github.com/psf/requests (docs/user/quickstart.rst) | Apache-2.0 |
| pip-README.rst | github.com/pypa/pip (README.rst) | MIT |
| scipy-README.rst | github.com/scipy/scipy (README.rst) | BSD-3-Clause |

Written by `scripts/make_samples.py`: readme-github.rst, sphinx-api.rst, grid-tables.rst, admonitions.rst, math.rst,
main-with-include.rst (with inc/), and the hostile files hostile-*.rst. The 2 MB file with 5,000 sections is written
with `--large <path>` outside this folder.
