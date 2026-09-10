-- Project reference slice: optimistic concurrency token.
ALTER TABLE "Project" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
