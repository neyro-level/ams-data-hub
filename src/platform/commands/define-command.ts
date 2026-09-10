import { z } from "zod";
import {
  runInDatabaseTransaction,
  type DatabaseTransaction,
} from "../database/transaction.ts";

export interface CommandExecution<TPrincipal, TInput> {
  principal: TPrincipal;
  input: TInput;
  transaction: DatabaseTransaction;
}

export interface CommandDefinition<TPrincipal, TSchema extends z.ZodType, TResult> {
  name: string;
  input: TSchema;
  authorize: (principal: TPrincipal, input: z.output<TSchema>) => Promise<void> | void;
  execute: (
    execution: CommandExecution<TPrincipal, z.output<TSchema>>,
  ) => Promise<TResult>;
}

export function defineCommand<TPrincipal, TSchema extends z.ZodType, TResult>(
  definition: CommandDefinition<TPrincipal, TSchema, TResult>,
) {
  return async (principal: TPrincipal, rawInput: z.input<TSchema>): Promise<TResult> => {
    const input = definition.input.parse(rawInput);
    await definition.authorize(principal, input);

    return runInDatabaseTransaction((transaction) =>
      definition.execute({ principal, input, transaction }),
    );
  };
}
