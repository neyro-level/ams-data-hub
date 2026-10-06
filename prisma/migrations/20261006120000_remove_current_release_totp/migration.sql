-- MP-01: approved current-release password/session policy, without TOTP.
-- Better Auth 1.7.7 username-only schema does not own these factor fields.
-- Preserve accounts, sessions, setup/recovery tokens, RateLimit and RLS.
-- No CASCADE: unexpected external dependants must fail, not be dropped.
BEGIN;
DROP TABLE "TwoFactor";
ALTER TABLE "User" DROP COLUMN "twoFactorEnabled";
ALTER TABLE "Session" DROP COLUMN "twoFactorVerifiedAt";
COMMIT;
