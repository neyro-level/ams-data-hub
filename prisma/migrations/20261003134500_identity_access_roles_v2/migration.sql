-- DH-01.1: replace starter role names without rewriting existing migrations.
ALTER TYPE "SystemRole" RENAME TO "SystemRole_old";
CREATE TYPE "SystemRole" AS ENUM ('PLATFORM_ADMIN', 'USER');
ALTER TABLE "User" ALTER COLUMN "systemRole" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "systemRole" TYPE "SystemRole"
  USING CASE WHEN "systemRole"::text = 'PLATFORM_ADMIN' THEN 'PLATFORM_ADMIN'::"SystemRole" ELSE 'USER'::"SystemRole" END;
ALTER TABLE "User" ALTER COLUMN "systemRole" SET DEFAULT 'USER';
DROP TYPE "SystemRole_old";

ALTER TYPE "MembershipRole" RENAME VALUE 'ORG_OWNER' TO 'ORG_ADMIN';
ALTER TYPE "MembershipRole" RENAME VALUE 'ORG_MEMBER' TO 'ORG_EDITOR';
ALTER TYPE "MembershipRole" RENAME VALUE 'VIEWER' TO 'ORG_VIEWER';

CREATE TYPE "ProjectMemberRole" AS ENUM ('PROJECT_EDITOR', 'PROJECT_VIEWER');

CREATE TABLE "ProjectMember" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "ProjectMemberRole" NOT NULL DEFAULT 'PROJECT_VIEWER',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectMember_organizationId_projectId_userId_key" ON "ProjectMember"("organizationId", "projectId", "userId");
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");
CREATE INDEX "ProjectMember_organizationId_projectId_idx" ON "ProjectMember"("organizationId", "projectId");
