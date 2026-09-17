# Neon and Cross-Repository Operations

## Cardiology-NP-System-Control
Neon project `sparkling-morning-59395715` is system-level coordination/metadata authority. Relevant tables include `system_component`, `system_repository`, `system_dependency`, `system_release`, `system_release_component`, `build_authority`, `build_receipt_ref`, `architecture_decision`, `system_event`, and `system_event_head`.

The EKG component deliberately has two identities:
1. immutable accepted engineering baseline/release identity; and
2. latest observed GitHub main commit/tree/CI in mutable observation metadata/events.

Routine donor work must not rewrite the immutable accepted baseline. After accepted main changes, reconcile only observed GitHub metadata forward.

Append events only through `public.system_append_event(idempotency_key,event_type,actor,payload)`. It enforces idempotency and event hash-chain ordering. Never handcraft `system_event` or `system_event_head` rows.

Never store PHI/raw ECG payloads, project gold, model predictions as truth, or diagnostic authority in System-Control.

## Cardiology-NP-Build-Ledger
Neon project `shy-cell-86869303` had no user tables at the 2026-09-17 audit. Reinspect live state before use. Do not invent a schema or runtime dependency.

## Platform
`Cardiology-NP-OS/Cardiology-NP-Platform` is a downstream integration consumer. System-Control records active EKG -> Platform contract dependencies while EKG remains governed inactive. Read live Platform state before any explicit integration change; donor work must not silently repin Platform.

## Research holding area
`sethburkhardt21-dev/EKG-RESEARCH-HOLDING-AREA` is a separate NON_RUNTIME extraction/evidence warehouse. Its contents require immutable source pinning, licensing, brand-neutral normalization, tests, and governed promotion before canonical EKG adoption.

## Safe external mutation sequence
1. read live state and authority;
2. identify current owner/branch/transaction;
3. detect concurrent advancement;
4. use idempotent or expected-parent mutation;
5. record exact resulting identities;
6. verify local and external invariants;
7. update observed coordination metadata without changing immutable authority.
