-- Identity admin slice: optimistic concurrency tokens for mutable aggregates.
ALTER TABLE "Organization" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Member" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
