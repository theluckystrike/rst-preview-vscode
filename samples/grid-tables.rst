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
