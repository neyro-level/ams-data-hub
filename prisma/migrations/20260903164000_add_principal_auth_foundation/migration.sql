-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('ORG_OWNER', 'ORG_MEMBER', 'VIEWER');

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "twoFactorEnabled" BOOLEAN DEFAULT false;

-- AlterTable
ALTER TABLE "Member"
  ADD COLUMN "tenantRole" "MembershipRole" NOT NULL DEFAULT 'VIEWER';

-- CreateTable
CREATE TABLE "TwoFactor" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "backupCodes" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT true,
  "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),

  CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TwoFactor_userId_key" ON "TwoFactor"("userId");

-- AddForeignKey
ALTER TABLE "TwoFactor"
  ADD CONSTRAINT "TwoFactor_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
