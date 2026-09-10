import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineCommand } from "../src/platform/commands/define-command.ts";

describe("defineCommand", () => {
  it("validates and authorizes before opening the database transaction", async () => {
    const authorize = vi.fn(() => {
      throw new Error("ACCESS_DENIED");
    });
    const execute = vi.fn();
    const command = defineCommand({
      name: "test.command",
      input: z.object({ value: z.string().min(1) }),
      authorize,
      execute,
    });

    await expect(command({ kind: "test" }, { value: "" })).rejects.toBeInstanceOf(z.ZodError);
    expect(authorize).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();

    await expect(command({ kind: "test" }, { value: "valid" })).rejects.toThrow("ACCESS_DENIED");
    expect(authorize).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });
});
