# Research Evidence Format

Research evidence is NON_RUNTIME_AUTHORITY. It may inform engineering, evaluation, dataset/model metadata, benchmarks, failure modes, and challenger hypotheses. It does not establish project clinical gold or target diagnostic validity.

Store article records under `research/literature/` using `ARTICLE_EVIDENCE_SCHEMA.json`.

## Article identity
Record exact title, authors, journal/venue, publication date, DOI, PMID/PMCID when available, canonical URL, publication status/version, article license/access status, retrieval date, and authoritative identity sources. Prefer the final peer-reviewed article over a preprint while preserving predecessor relationships.

## Atomic claims
Each claim records: stable `claim_id`; `claim_type`; one falsifiable statement; exact locator (section/table/figure/page/field, not a bare URL); dataset/cohort/split when relevant; metric definition/value only if actually reported; preprocessing/model/checkpoint context; limitations; and authority flags.

Allowed types include `SOURCE_FACT`, `METHOD_DESCRIPTION`, `DATASET_FACT`, `MODEL_FACT`, `PUBLISHED_PERFORMANCE_CLAIM`, `LIMITATION`, `FAILURE_MODE`, `LICENSE_FACT`, `ENGINEERING_HYPOTHESIS`.

Every research claim remains `project_gold=false`, `runtime_authority=false`, `clinical_validity_inferred=false`. Published claims remain `target_reproduced=false` unless an EKG-controlled reproduction is separately committed with exact dataset/split/preprocessing/metric evidence.

If credible sources disagree, retain both and link a conflict group; do not silently pick a winner. Corrections create a new version/record with predecessor hash and supersession reason rather than rewriting released evidence.

## Discovery / verification sources
Use authoritative publisher/PMC/PubMed/Crossref records, Elicit, public repository releases, model/dataset cards, standards, and first-party documentation as appropriate. Pin immutable repository/checkpoint/data versions separately. Tool failure is a retrieval limitation, not permission to invent metadata.

## Literature queue
For each donor/model/dataset, look for the primary publication or data descriptor. Before interpreting challenger performance, seek external validation, calibration, subgroup, failure-mode, and reproducibility literature where available. Record absence/limitations explicitly.
