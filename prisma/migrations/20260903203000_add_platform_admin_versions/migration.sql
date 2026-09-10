-- Platform Admin slice: optimistic concurrency tokens for mutable registry aggregates.
ALTER TABLE "ThresholdProfile" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "QueryClusterProfile" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Site" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProviderConnection" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GoalDefinition" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TrackedQuerySet" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
