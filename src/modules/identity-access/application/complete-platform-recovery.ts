import { createHash } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { runInDatabaseTransaction } from "../../../platform/database/transaction.ts";
import { completePlatformRecoveryInputSchema, type CompletePlatformRecoveryInput } from "../domain/admin-identity.ts";
import { PrismaIdentityAdminRepository } from "../infrastructure/prisma-identity-admin-repository.ts";

export async function completePlatformRecovery(rawInput: CompletePlatformRecoveryInput): Promise<{ userId: string } | null> {
  const input = completePlatformRecoveryInputSchema.parse(rawInput);
  const tokenHash = createHash("sha256").update(input.token).digest("hex");
  const passwordHash = await hashPassword(input.password);
  const userId = await runInDatabaseTransaction((transaction) => new PrismaIdentityAdminRepository(transaction).completePlatformRecovery({ tokenHash, passwordHash, now: new Date() }));
  return userId ? { userId } : null;
}
