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
