# Task graph migration — 2026-10-08

Owner explicitly approved migration of the saved AMS Data Hub graph to PlanDB
after removing Beads in a separate workflow. Production authority is unchanged.

## Source and destination

- Original immutable backup: `C:/Users/User/Desktop/Data-skill/beads-uninstall-backup-20261008/payload/store-7`.
- Beads issue export: local-only `beads-migration-source.jsonl`, SHA-256
  `7b3b037c8fb4088b22060e28dcb8c37def8cd481dfe3b537937ad068b7a6c608`.
- Destination: local-only `.plandb.db`, PlanDB 0.2.1 project `p-qsgr`, `AMS Data Hub`.
- Identity mapping: original `adh-*` becomes `t-adh-*`; original IDs, records,
  labels, approval/source hashes and metadata remain preserved verbatim.
- Priority order is preserved with Beads P0 → PlanDB 4, P4 → 0; PlanDB selects
  descending priorities. Original Beads numbers remain untouched in metadata.
- No active Beads store was recreated. Full historical Dolt data stays in backup;
  this migration ports the issue graph and evidence, not Dolt commit history.

## Verified preservation

189 issues imported: 172 `closed` → `done`, 3 `in_progress` → `running`,
14 `open` → `pending` (native readiness promotion applies when dependencies finish).
All 82 managed v4 nodes remain done. Remediation retains all 97 managed nodes;
10 additional historical issues are preserved too.

374 `blocks` edges retain ordering: Beads dependent `issue_id` / upstream
`depends_on_id` maps to PlanDB upstream `from_task` / dependent `to_task`.
163 `parent-child` edges become containment. Eight `discovered-from` edges
become nonblocking `suggests` links, with the original edge retained in metadata.

Every original record is also attached as a JSON artifact; original notes are
copied into task notes and closed evidence into results. Source timestamps remain
exact in the original record; runtime dates use PlanDB's seconds-only format.
Initial CLI parsing failures on fractional timestamps were diagnosed and repaired
without changing the preserved original records.

Migration and read-back verification: exact original records, statuses, hierarchy,
dependency types/orientation, artifacts; dependency cycle check, SQLite integrity
and foreign-key checks — PASS. Native PlanDB status read — PASS after date repair.
The default YAML template import was not used because it resets statuses and
omits execution evidence; the inspected installed schema was used transactionally.

## Subsequent work

Scenario A was already closed before backup. B–D were running in the backup and
subsequently completed through native PlanDB `done`, with pushed checkpoint
`fa0e78bfb3f8796d4a7a3c805ee613ec924fbdc3`, actual native test `64239/67891d`
(3/3, 63 migrations and final reset), types/scoped lint `59350/1ebc0b`, docs/secret
checks and independent architect review. This is completion after migration,
not a change to the historical imported evidence.

Use PlanDB for current execution. Historical `beads://` delivery pointers identify
the preserved original task ID; read its `t-`-prefixed PlanDB notes/JSON artifact.
Keep SourceCraft canonical and mirror only merged main. No staging/production,
real feed/PII, new credentials or server changes are authorized by this migration.
