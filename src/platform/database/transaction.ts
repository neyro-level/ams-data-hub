import { Prisma } from "../../generated/prisma/client.ts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { PrincipalContext } from "../authorization/principal.ts";
import { getPrismaClient } from "./prisma/client.ts";

export type DatabaseTransaction = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

type DatabasePrincipalKind = PrincipalContext["kind"] | "identity" | "system-job";

export interface DatabaseAuthorizationContext {
  principalKind: DatabasePrincipalKind;
  actorId: string;
  organizationId: string | null;
  correlationId: string;
}

export function createDatabaseAuthorizationContext(
  principal: PrincipalContext,
): DatabaseAuthorizationContext {
  switch (principal.kind) {
    case "tenant-user":
      return {
        principalKind: principal.kind,
        actorId: principal.userId,
        organizationId: principal.organizationId,
        correlationId: principal.correlationId,
      };
    case "platform-admin":
      return {
        principalKind: principal.kind,
        actorId: principal.userId,
        organizationId: null,
        correlationId: principal.correlationId,
      };
    case "api-client":
      return {
        principalKind: principal.kind,
        actorId: principal.apiClientId,
        organizationId: principal.organizationId,
        correlationId: principal.correlationId,
      };
    case "job":
      return {
        principalKind: principal.kind,
        actorId: principal.jobName,
        organizationId: principal.organizationId,
        correlationId: principal.correlationId,
      };
  }
}

export function createIdentityDatabaseAuthorizationContext(input: {
  userId: string;
  correlationId: string;
}): DatabaseAuthorizationContext {
  return {
    principalKind: "identity",
    actorId: input.userId,
    organizationId: null,
    correlationId: input.correlationId,
  };
}

export function createSystemJobDatabaseAuthorizationContext(input: {
  jobName: string;
  correlationId: string;
}): DatabaseAuthorizationContext {
  return {
    principalKind: "system-job",
    actorId: input.jobName,
    organizationId: null,
    correlationId: input.correlationId,
  };
}

async function setTransactionContext(
  transaction: DatabaseTransaction,
  context: DatabaseAuthorizationContext,
): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`
    select
      set_config('app.principal_kind', ${context.principalKind}, true),
      set_config('app.actor_id', ${context.actorId}, true),
      set_config('app.organization_id', ${context.organizationId ?? ""}, true),
      set_config('app.correlation_id', ${context.correlationId}, true)
  `);
}

export async function runInDatabaseTransaction<TResult>(
  execute: (transaction: DatabaseTransaction) => Promise<TResult>,
): Promise<TResult> {
  return getPrismaClient().$transaction(execute);
}

export async function runInAuthorizedDatabaseTransaction<TResult>(
  context: DatabaseAuthorizationContext,
  execute: (transaction: DatabaseTransaction) => Promise<TResult>,
): Promise<TResult> {
  return getPrismaClient().$transaction(async (transaction) => {
    await setTransactionContext(transaction, context);
    return execute(transaction);
  });
}

export async function runInPrincipalDatabaseTransaction<TResult>(
  principal: PrincipalContext,
  execute: (transaction: DatabaseTransaction) => Promise<TResult>,
): Promise<TResult> {
  return runInAuthorizedDatabaseTransaction(
    createDatabaseAuthorizationContext(principal),
    execute,
  );
}

export async function runInSystemJobDatabaseTransaction<TResult>(
  input: { jobName: string; correlationId: string },
  execute: (transaction: DatabaseTransaction) => Promise<TResult>,
): Promise<TResult> {
  return runInAuthorizedDatabaseTransaction(
    createSystemJobDatabaseAuthorizationContext(input),
    execute,
  );
}
