import { createHash } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { completeAccountSetupInputSchema, type CompleteAccountSetupInput } from "../domain/admin-identity.ts";
import type { IdentityAdminRepository } from "./ports/identity-admin-repository.ts";

type AccountSetupRepository = Pick<IdentityAdminRepository, "completeAccountSetup">;

export interface CompleteAccountSetupDependencies {
  withRepository<TResult>(
    execute: (repository: AccountSetupRepository) => Promise<TResult>,
  ): Promise<TResult>;
}

export function createCompleteAccountSetup(dependencies: CompleteAccountSetupDependencies) {
  return async function completeAccountSetup(
    rawInput: CompleteAccountSetupInput,
  ): Promise<{ userId: string } | null> {
    const input = completeAccountSetupInputSchema.parse(rawInput);
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    const passwordHash = await hashPassword(input.password);
    const userId = await dependencies.withRepository((repository) =>
      repository.completeAccountSetup({ tokenHash, passwordHash, now: new Date() }),
    );
    return userId ? { userId } : null;
  };
}
