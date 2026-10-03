-- Account-level password lockout. Better Auth owns the companion TOTP lockout.
ALTER TABLE "User"
  ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "loginLockedUntil" TIMESTAMPTZ(3);

CREATE INDEX "User_loginLockedUntil_idx" ON "User"("loginLockedUntil");
