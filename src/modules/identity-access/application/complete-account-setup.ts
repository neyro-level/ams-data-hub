import { createHash } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { runInDatabaseTransaction } from "../../../platform/database/transaction.ts";
import { completeAccountSetupInputSchema, type CompleteAccountSetupInput } from "../domain/admin-identity.ts";
import { PrismaIdentityAdminRepository } from "../infrastructure/prisma-identity-admin-repository.ts";

export async function completeAccountSetup(rawInput: CompleteAccountSetupInput): Promise<{ userId: string } | null> {
  const input = completeAccountSetupInputSchema.parse(rawInput);
  const tokenHash = createHash("sha256").update(input.token).digest("hex");
  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  const userId = await runInDatabaseTransaction((transaction) =>
    new PrismaIdentityAdminRepository(transaction).completeAccountSetup({ tokenHash, passwordHash, now }),
  );
  return userId ? { userId } : null;
}
