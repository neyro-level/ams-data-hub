-- Better Auth 1.7.3+ identifies accounts by providerId + accountId and no
-- longer writes issuer. Keep the legacy column nullable for a compatibility
-- release so existing issuer data is preserved.
ALTER TABLE "Account" ALTER COLUMN "issuer" DROP NOT NULL;

DROP INDEX "Account_issuer_accountId_key";

CREATE UNIQUE INDEX "Account_providerId_accountId_key"
ON "Account"("providerId", "accountId");
