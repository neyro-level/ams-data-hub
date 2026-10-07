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
  projectIds: readonly string[] | "*";
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
        projectIds: principal.projectIds,
        correlationId: principal.correlationId,
      };
    case "platform-admin":
      return {
        principalKind: principal.kind,
        actorId: principal.userId,
        organizationId: null,
        projectIds: "*",
        correlationId: principal.correlationId,
      };
    case "api-client":
      return {
        principalKind: principal.kind,
        actorId: principal.apiClientId,
        organizationId: principal.organizationId,
        projectIds: principal.projectIds,
        correlationId: principal.correlationId,
      };
    case "job":
      return {
        principalKind: principal.kind,
        actorId: principal.jobName,
        organizationId: principal.organizationId,
        projectIds: principal.projectIds,
        correlationId: principal.correlationId,
      };
    case "project-job":
      return {
        principalKind: principal.kind,
        actorId: principal.jobName,
        organizationId: principal.organizationId,
        projectIds: [principal.projectId],
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
    projectIds: [],
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
    projectIds: "*",
    correlationId: input.correlationId,
  };
}

export function createProjectDatabaseAuthorizationContext(
  principal: PrincipalContext,
  projectId: string,
): DatabaseAuthorizationContext {
  const context = createDatabaseAuthorizationContext(principal);
  return {
    ...context,
    projectIds:
      context.projectIds === "*" || context.projectIds.includes(projectId)
        ? [projectId]
        : [],
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
      set_config('app.project_ids', ${context.projectIds === "*" ? "*" : context.projectIds.join(",")}, true),
      set_config('app.correlation_id', ${context.correlationId}, true)
  `);
}

export async function runInIdentityBootstrapDatabaseTransaction<TResult>(
  execute: (transaction: DatabaseTransaction) => Promise<TResult>,
): Promise<TResult> {
  return getPrismaClient().$transaction(execute);
}

export async function runInAuthorizedDatabaseTransaction<TResult>(
  context: DatabaseAuthorizationContext,
  execute: (transaction: DatabaseTransaction) => Promise<TResult>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number },
): Promise<TResult> {
  return getPrismaClient().$transaction(async (transaction) => {
    await setTransactionContext(transaction, context);
    return execute(transaction);
  }, options);
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

export async function runInProjectPrincipalDatabaseTransaction<TResult>(
  principal: PrincipalContext,
  projectId: string,
  execute: (transaction: DatabaseTransaction) => Promise<TResult>,
): Promise<TResult> {
  return runInAuthorizedDatabaseTransaction(
    createProjectDatabaseAuthorizationContext(principal, projectId),
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
