"""Writes the generated sample and hostile .rst files for the tests and the real VS Code gate.

usage: python3 -I scripts/make_samples.py <samples dir> [--large <path>]
The real-world samples (docutils demo, Sphinx, CPython, Django, pip and SciPy pages) are downloaded once and kept in
samples/; this script writes the rest. --large writes a ~2 MB file with 5,000 sections (kept outside samples/).
"""
import os
import sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
os.makedirs(os.path.join(out, 'inc'), exist_ok=True)


def w(name, text):
    with open(os.path.join(out, name), 'w', encoding='utf-8') as f:
        f.write(text.lstrip('\n'))


w('readme-github.rst', r'''
==========
Tidewater
==========

|build| |pypi| |license|

**Tidewater** reads tide gauge files and turns them into clean time series.
It is a small, typed Python library with no compiled parts.

.. contents:: On this page
   :local:
   :depth: 1

Install
=======

.. code-block:: console

   $ pip install tidewater

Python 3.9 or newer is needed. On Windows, use ``py -m pip install tidewater``.

Quick start
===========

.. code-block:: python
   :caption: read_station.py
   :emphasize-lines: 4

   from tidewater import Station

   station = Station.from_file("data/9414290.csv")
   series = station.resample("1h").fill(limit=3)
   print(series.describe())

Features
========

* Reads NOAA CSV, PSMSL and GESLA files
* Gap filling with a limit, so long gaps stay visible
* Tidal datums: MLLW, MLW, MSL, MHW, MHHW

  - each datum has a short name and a long name
  - values are in metres unless you ask for feet

* Plots with matplotlib, if it is installed

1. Load a station
2. Resample it
3. Export to Parquet or CSV

.. note::
   The API is not stable before 1.0. Pin the minor version in your requirements.

.. warning:: Files from before 1970 may use local time. Check ``station.tz`` first.

Supported formats
=================

=========  =============  ==============
Format     Extension      Since version
=========  =============  ==============
NOAA CSV   ``.csv``       0.1
PSMSL      ``.rlrdata``   0.2
GESLA-3    ``.txt``       0.4
=========  =============  ==============

Contributing
============

Read `CONTRIBUTING.rst <CONTRIBUTING.rst>`_ first. Bugs go to the `issue tracker`_.
Questions: tidewater@example.org.

License
=======

MIT, see ``LICENSE``.

.. |build| image:: https://img.shields.io/github/actions/workflow/status/example/tidewater/ci.yml
   :alt: build status
.. |pypi| image:: https://img.shields.io/pypi/v/tidewater
   :alt: PyPI version
.. |license| image:: https://img.shields.io/badge/license-MIT-blue
   :alt: MIT license
.. _issue tracker: https://github.com/example/tidewater/issues
''')

w('sphinx-api.rst', r'''
.. _api-reference:

API reference
=============

.. currentmodule:: tidewater

.. toctree::
   :maxdepth: 2
   :caption: Contents

   install
   Quick start <quickstart>
   changelog

This page is built by Sphinx from the docstrings. See :ref:`api-reference` and :doc:`install`.
The main entry point is :py:class:`tidewater.Station`; :func:`~tidewater.read` is a shortcut.
Set :envvar:`TIDEWATER_CACHE` to move the cache. Press :kbd:`Ctrl+C` to stop.

.. automodule:: tidewater
   :members:
   :undoc-members:

.. autoclass:: tidewater.Station
   :members: resample, fill

.. py:function:: read(path, *, tz=None)

   Read a gauge file.

   :param path: file to read
   :type path: str or os.PathLike
   :param tz: time zone of the timestamps
   :returns: a :class:`Series`
   :raises ValueError: if the file has no header

.. versionadded:: 0.4
   The *tz* argument.

.. deprecated:: 0.6
   Use :func:`read` instead of ``load``.

.. seealso::

   :doc:`formats` for the file layouts.

.. graphviz::

   digraph { read -> resample -> fill -> export }

.. tabs::

   .. tab:: pip

      ``pip install tidewater``

   .. tab:: conda

      ``conda install -c conda-forge tidewater``

.. glossary::

   datum
      A base height that other heights are measured from.

   MLLW
      Mean lower low water.
''')

w('grid-tables.rst', r'''
Grid tables
===========

A grid table with a header, a row span and a column span:

+------------+------------+-----------+
| Header 1   | Header 2   | Header 3  |
+============+============+===========+
| body row 1 | column 2   | column 3  |
+------------+------------+-----------+
| body row 2 | Cells may span columns.|
+------------+------------+-----------+
| body row 3 | Cells may  | - Cells   |
+------------+ span rows. | - contain |
| body row 4 |            | - blocks. |
+------------+------------+-----------+

Simple table with a column span in the header:

=====  =====  ======
   Inputs     Output
------------  ------
  A      B    A or B
=====  =====  ======
False  False  False
True   False  True
False  True   True
True   True   True
=====  =====  ======

.. list-table:: Frozen delights
   :widths: 15 10 30
   :header-rows: 1

   * - Treat
     - Quantity
     - Description
   * - Albatross
     - 2.99
     - On a stick!
   * - Crunchy Frog
     - 1.49
     - If we took the bones out, it would not be crunchy.

.. csv-table:: Station list
   :header: "Station", "Lat", "Lon"
   :widths: 30, 15, 15

   "San Francisco, CA", 37.807, -122.465
   "Seattle, WA", 47.602, -122.339
   "Honolulu, HI", 21.307, -157.867

A broken grid table (the borders do not line up):

+-----+-----+
| a   | b   |
+-----+---+
| c   | d   |
+-----+-----+
''')

w('admonitions.rst', r'''
Admonitions
===========

.. note:: A note.

.. tip:: A tip.

.. hint:: A hint.

.. important:: Important text.

.. warning:: A warning.

.. caution:: Be careful.

.. attention:: Attention please.

.. danger:: Danger zone.

.. error:: An error.

.. admonition:: A custom title

   Any text, with *inline* markup and a list:

   - one
   - two

.. note::

   A note with two paragraphs.

   .. code-block:: python

      print("and code")
''')

w('math.rst', r'''
Math
====

Inline math: :math:`e^{i\pi} + 1 = 0` and :math:`\sum_{k=1}^{n} k = \frac{n(n+1)}{2}`.

.. math::

   \int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}

.. math::
   :label: euler

   \nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}

   \nabla \times \mathbf{B} = \mu_0 \mathbf{J} + \mu_0\varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}

A broken formula shows in red and does not stop the page: :math:`\frac{1}{`.
''')

w('main-with-include.rst', r'''
Main file with includes
=======================

.. include:: inc/part-a.rst

.. literalinclude:: inc/example.py
   :language: python
   :lines: 1-3

.. csv-table:: From a file
   :file: inc/data.csv
   :header-rows: 1

.. image:: images/title.png
   :alt: title picture
   :width: 200px
''')
w('inc/part-a.rst', r'''
Included section
----------------

This paragraph comes from ``inc/part-a.rst``.

.. include:: part-b.rst
''')
w('inc/part-b.rst', 'And this one from ``inc/part-b.rst``, two levels down.\n')
w('inc/example.py', 'def hello():\n    return "hi"\nprint(hello())\nprint("not shown")\n')
w('inc/data.csv', 'Name,Value\nalpha,1\nbeta,2\n')

# ---- hostile files
w('hostile-raw-html.rst', r'''
Hostile raw HTML
================

.. raw:: html

   <p id="ok">Allowed paragraph with <b>bold</b>.</p>
   <script>window.__pwned = 1; document.title = "pwned";</script>
   <img src="x" onerror="window.__pwned = 2">
   <img src="javascript:window.__pwned=3">
   <a href="javascript:window.__pwned=4">click me</a>
   <a href="JaVa&#x09;ScRiPt:window.__pwned=5">entity trick</a>
   <iframe src="https://example.com"></iframe>
   <svg onload="window.__pwned=6"><circle r="5"/></svg>
   <div style="background:url(https://example.com/track.png)">styled</div>
   <form action="https://example.com"><input name="x"></form>
   <object data="x.swf"></object>
   <math><mtext><style><img src=x onerror="window.__pwned=7"></style></mtext></math>

A `javascript link <javascript:alert(1)>`_ and a `data link <data:text/html,<script>alert(1)</script>>`_.

.. _evil: javascript:window.__pwned=8

A named reference to evil_ and an image with a bad source:

.. image:: javascript:alert(1)

.. raw:: html
   :file: /etc/passwd

:raw-html:`<b>inline</b>` (unknown role, shown as code).
''')

w('hostile-paths.rst', r'''
Hostile paths
=============

.. include:: /etc/passwd

.. include:: ../../../../../../../../etc/passwd

.. include:: ../outside.rst

.. literalinclude:: /etc/hosts

.. csv-table::
   :file: ../../../../etc/passwd

.. image:: ../../../../../../etc/hosts

.. image:: /etc/hosts

.. include:: hostile-cycle-a.rst

`file link <file:///etc/passwd>`_ and `parent link <../../../etc/passwd>`_.
''')
w('hostile-cycle-a.rst', 'Cycle A\n\n.. include:: hostile-cycle-b.rst\n')
w('hostile-cycle-b.rst', 'Cycle B\n\n.. include:: hostile-cycle-a.rst\n')

deep = ['Deep nesting', '============', '']
for i in range(500):
    deep.append(' ' * i + f'level {i}')
    deep.append('')
w('hostile-deep.rst', '\n'.join(deep) + '\n')

# Many unmatched start-strings on one long line (a slow-parser trap) plus odd bytes.
w('hostile-garbage.rst', 'Garbage\n=======\n\n' + ('*a ' * 20000) + '\n\n' + ('`x ' * 20000) + '\n\n' + ('|s ' * 5000) + '\n\n'
  + '\x00\x01\x02 control bytes � and a stray ``literal\n\n' + '+' + '-' * 3000 + '+\n| broken\n\n' + ('.. ' * 3000) + '\n')

if '--large' in sys.argv:
    path = sys.argv[sys.argv.index('--large') + 1]
    parts = ['Large document', '==============', '', '.. contents::', '   :depth: 1', '']
    k = 0
    while k < 5000:
        k += 1
        parts += [f'Section {k}', '-' * (len(str(k)) + 8), '',
                  f'Paragraph {k} with *emphasis*, **strong**, ``code`` and a `link <https://example.com/{k}>`_. '
                  'Tide gauges record the height of the sea surface every few minutes, and the record is used for flood '
                  'warnings, harbour design and sea level studies. This filler text makes each section about four '
                  'hundred bytes long, like a real reference page.',
                  '', f'- item {k}.1', f'- item {k}.2', '',
                  '.. note::', f'   Note {k}.', '']
        if k % 50 == 0:
            parts += ['.. code-block:: python', '', f'   def f{k}(x):', f'       return x * {k}', '']
        if k % 100 == 0:
            parts += ['=====  =====', 'a      b', '=====  =====', f'{k}      {k + 1}', '=====  =====', '']
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(parts) + '\n')
    print('large', path, os.path.getsize(path), 'bytes', k, 'sections')
