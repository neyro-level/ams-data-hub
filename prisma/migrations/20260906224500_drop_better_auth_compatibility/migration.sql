DROP INDEX IF EXISTS "Session_activeOrganizationId_idx";

ALTER TABLE "Session"
  DROP COLUMN "activeOrganizationId";

ALTER TABLE "Member"
  DROP COLUMN "role";

DROP TABLE "Invitation";
