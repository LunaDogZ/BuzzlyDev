# Buzzly's Airflow image: upstream 3.2.2 plus the one thing the ingestion
# pipeline needs that the base image does not ship.
#
# Why a Dockerfile rather than `_PIP_ADDITIONAL_REQUIREMENTS`: that variable
# re-installs on every container start, so five services each pay the install,
# a network blip at boot becomes a broken stack, and the running version is
# whatever PyPI served most recently rather than what was tested. Baking it in
# makes the image reproducible, which the research measurements depend on.
ARG AIRFLOW_VERSION=3.2.2
FROM apache/airflow:${AIRFLOW_VERSION}

# openpyxl reads .xlsx. pandas is already present in the base image but cannot
# open a workbook without it — a merchant uploading the Excel file they actually
# have would otherwise get "cannot read this format" for the commonest format
# in the wedge's own use case.
#
# Legacy .xls (xlrd) is deliberately NOT installed: the upload picker rejects
# that extension, and `reader.detect_format` catches a renamed one by its OLE2
# magic bytes and tells the merchant to re-save as .xlsx.
RUN pip install --no-cache-dir openpyxl==3.1.5
