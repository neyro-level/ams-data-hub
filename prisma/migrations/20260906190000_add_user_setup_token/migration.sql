-- CreateTable
CREATE TABLE "UserSetupToken" (
    "id" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSetupToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSetupToken_tokenHash_key" ON "UserSetupToken"("tokenHash");
CREATE INDEX "UserSetupToken_userId_createdAt_idx" ON "UserSetupToken"("userId", "createdAt");
CREATE INDEX "UserSetupToken_expiresAt_idx" ON "UserSetupToken"("expiresAt");

ALTER TABLE "UserSetupToken"
ADD CONSTRAINT "UserSetupToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
