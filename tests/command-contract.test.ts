import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createCommandFactory,
  type CommandTransactionRunner,
} from "../src/platform/commands/define-command.ts";
import type { PlatformAdminPrincipal } from "../src/platform/authorization/principal.ts";
import type { DatabaseTransaction } from "../src/platform/database/transaction.ts";

const principal: PlatformAdminPrincipal = {
  kind: "platform-admin",
  userId: "command-contract-admin",
  correlationId: "command-contract-correlation",
};

describe("command transaction contract", () => {
  it("validates and authorizes before opening exactly one transaction", async () => {
    const events: string[] = [];
    const transaction = {} as DatabaseTransaction;
    const runInTransaction: CommandTransactionRunner = async (_principal, execute) => {
      events.push("transaction");
      return execute(transaction);
    };
    const defineCommand = createCommandFactory({ runInTransaction });
    const command = defineCommand({
      name: "test.command",
      input: z.object({ value: z.string().min(1) }).transform((input) => {
        events.push("validate");
        return input;
      }),
      authorize: () => {
        events.push("authorize");
      },
      execute: ({ transaction: commandTransaction, input }) => {
        events.push("execute");
        expect(commandTransaction).toBe(transaction);
        return Promise.resolve(input.value);
      },
    });

    await expect(command(principal, { value: "accepted" })).resolves.toBe("accepted");
    expect(events).toEqual(["validate", "authorize", "transaction", "execute"]);
  });

  it("does not open a transaction for invalid or unauthorized input", async () => {
    const transactionOpened = vi.fn();
    const runInTransaction: CommandTransactionRunner = async (_principal, execute) => {
      transactionOpened();
      return execute({} as DatabaseTransaction);
    };
    const defineCommand = createCommandFactory({ runInTransaction });
    const invalidCommand = defineCommand({
      name: "test.invalid",
      input: z.object({ value: z.string().min(1) }),
      authorize: () => undefined,
      execute: () => Promise.resolve(),
    });
    const unauthorizedCommand = defineCommand({
      name: "test.unauthorized",
      input: z.object({ value: z.string().min(1) }),
      authorize: () => {
        throw new Error("ACCESS_DENIED");
      },
      execute: () => Promise.resolve(),
    });

    await expect(invalidCommand(principal, { value: "" })).rejects.toBeDefined();
    await expect(unauthorizedCommand(principal, { value: "accepted" })).rejects.toThrow(
      "ACCESS_DENIED",
    );
    expect(transactionOpened).not.toHaveBeenCalled();
  });
});
