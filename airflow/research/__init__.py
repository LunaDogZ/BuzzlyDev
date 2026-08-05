"""Measurement harness for the Buzzly ingestion pipeline.

Separate from ``airflow/tests`` on purpose. The tests answer "is it correct?"
with a pass or a fail; this answers "how well, compared to what, and how fast?"
with numbers a write-up can quote. A test that starts reporting a percentage is
a test nobody can read, and a measurement that stops at pass/fail is not a
measurement.

Run it with ``python3 -m research.run`` from ``airflow/`` — see ``README.md``.
"""
