import { createHash } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { completePlatformRecoveryInputSchema, type CompletePlatformRecoveryInput } from "../domain/admin-identity.ts";
import type { IdentityAdminRepository } from "./ports/identity-admin-repository.ts";

type PlatformRecoveryRepository = Pick<IdentityAdminRepository, "completePlatformRecovery">;

export interface CompletePlatformRecoveryDependencies {
  withRepository<TResult>(
    execute: (repository: PlatformRecoveryRepository) => Promise<TResult>,
  ): Promise<TResult>;
}

export function createCompletePlatformRecovery(
  dependencies: CompletePlatformRecoveryDependencies,
) {
  return async function completePlatformRecovery(
    rawInput: CompletePlatformRecoveryInput,
  ): Promise<{ userId: string } | null> {
    const input = completePlatformRecoveryInputSchema.parse(rawInput);
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    const passwordHash = await hashPassword(input.password);
    const userId = await dependencies.withRepository((repository) =>
      repository.completePlatformRecovery({ tokenHash, passwordHash, now: new Date() }),
    );
    return userId ? { userId } : null;
  };
}
