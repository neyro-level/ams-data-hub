-- Exact pinned identity/hash lookup across approved historical GOOD revisions.
-- Scope and GOOD predicates remain in the caller query and FORCE RLS policies.
CREATE INDEX "SourceRevisionRecord_inventory_fact_idx"
ON "SourceRevisionRecord" ("inventoryUid", "externalId", "recordHash");
