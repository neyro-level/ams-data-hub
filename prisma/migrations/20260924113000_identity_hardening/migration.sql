ALTER TABLE "User"
  ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "setupCompletedAt" TIMESTAMPTZ(3);

ALTER TABLE "Session"
  ADD COLUMN "activeOrganizationId" TEXT,
  ADD COLUMN "twoFactorVerifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "setupCompletedAt" TIMESTAMPTZ(3);

CREATE TABLE "TwoFactor" (
  "id" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "backupCodes" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT true,
  "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RateLimit" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL,
  CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountSetupToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountSetupToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformRecoveryToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformRecoveryToken_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Session_activeOrganizationId_idx" ON "Session"("activeOrganizationId");
CREATE INDEX "TwoFactor_secret_idx" ON "TwoFactor"("secret");
CREATE INDEX "TwoFactor_userId_idx" ON "TwoFactor"("userId");
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");
CREATE UNIQUE INDEX "AccountSetupToken_tokenHash_key" ON "AccountSetupToken"("tokenHash");
CREATE INDEX "AccountSetupToken_userId_expiresAt_idx" ON "AccountSetupToken"("userId", "expiresAt");
CREATE UNIQUE INDEX "PlatformRecoveryToken_tokenHash_key" ON "PlatformRecoveryToken"("tokenHash");
CREATE INDEX "PlatformRecoveryToken_userId_expiresAt_idx" ON "PlatformRecoveryToken"("userId", "expiresAt");

ALTER TABLE "TwoFactor" ADD CONSTRAINT "TwoFactor_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountSetupToken" ADD CONSTRAINT "AccountSetupToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformRecoveryToken" ADD CONSTRAINT "PlatformRecoveryToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
