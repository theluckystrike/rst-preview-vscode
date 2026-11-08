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
