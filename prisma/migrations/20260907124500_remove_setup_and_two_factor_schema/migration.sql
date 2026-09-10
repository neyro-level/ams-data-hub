-- Release A no longer reads or writes the setup and two-factor compatibility schema.
-- Remove the obsolete records before dropping their owning tables and user flags.
DROP TABLE "UserSetupToken";
DROP TABLE "TwoFactor";

ALTER TABLE "User"
  DROP COLUMN "mustChangePassword",
  DROP COLUMN "twoFactorEnabled";
