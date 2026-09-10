import type { PrismaClient } from "../../generated/prisma/client.ts";
import { getPrismaClient } from "./prisma/client.ts";

export type DatabaseTransaction = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

export async function runInDatabaseTransaction<TResult>(
  execute: (transaction: DatabaseTransaction) => Promise<TResult>,
): Promise<TResult> {
  return getPrismaClient().$transaction(execute);
}
