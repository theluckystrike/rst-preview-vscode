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
