# ADR-014: Final Conformance And Handover Contract

**Status:** implemented for E11; final-main proof remains an owner merge-gate action

Final conformance is evaluated at one exact final `main` SHA, not by combining partial branch results. Every target guarantee receives one of: executable proof with exact evidence, explicit bounded exception, or deferred capability with owner/trigger. Docs, schema, code, SourceCraft template and runtime template must agree.

The final handover supplies: derivation checklist; `EXPERIMENT → COMMERCIAL | CRITICAL` hardening boundary; manual exact-head gate; immutable artifact/rollback template; database identity/backup obligations; secret and domain ownership; and a statement that the starter itself is not production.

`docs/HANDOVER.md` is the human-readable matrix. `pnpm verify:conformance`
checks its required links against the runtime template and emits the exact Git
commit/tree identity. `pnpm verify:release` includes that static conformance
check after the daily proof; `pnpm derive:smoke` remains the independent
copy-source proof.

E11 may close only after: all feature epics have delivered PR-only evidence; a clean final main has passed the applicable local daily/release-equivalent proof; clean-room derivation repeats successfully; and docs/source-of-truth links reconcile with runtime. Missing local PostgreSQL identity, SourceCraft authorization or other external prerequisites remain recorded blockers, never claimed proof.

| Conformance item | Evidence owner |
| --- | --- |
| profile, stack and identity | E00/E01 |
| auth, principal and RLS | E02/E03 |
| atomic commands and async | E04/E05 |
| integrated PostgreSQL proof | E00A/E06 |
| CI/runtime/UI safety | E07/E08/E09 |
| derivation and handover | E10/E11 |

E11 does not release, merge automatically or import a new plan without owner approval. It is PR-only and RISKY because it validates final security/runtime proof.
