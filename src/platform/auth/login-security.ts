import "server-only";

import { readAuthEnvironment } from "../config/server-environment.ts";
import { getPrismaClient } from "../database/prisma/client.ts";
import {
  createIdentityDatabaseAuthorizationContext,
  runInAuthorizedDatabaseTransaction,
} from "../database/transaction.ts";
import { createPublicErrorResponse } from "../http/error-envelope.ts";

const loginFailureLimit = 10;
const loginLockoutMs = 15 * 60 * 1000;

export async function getUsernameFromLoginRequest(request: Request): Promise<string | null> {
  if (request.method !== "POST" || !request.url.endsWith("/sign-in/username")) return null;
  try {
    const body: unknown = await request.clone().json();
    if (!body || typeof body !== "object" || !("username" in body)) return null;
    const username = (body as { username?: unknown }).username;
    return typeof username === "string" ? username.trim().toLowerCase() || null : null;
  } catch {
    return null;
  }
}

async function appendLoginAudit(input: { userId: string | null; action: string; correlationId: string }) {
  if (!input.userId) return;
  await runInAuthorizedDatabaseTransaction(
    createIdentityDatabaseAuthorizationContext({ userId: input.userId, correlationId: input.correlationId }),
    (transaction) => transaction.auditEvent.create({
    data: {
      actorType: "SYSTEM",
      actorId: input.userId,
      action: input.action,
      entityType: "User",
      entityId: input.userId,
      source: "auth",
      correlationId: input.correlationId,
    },
    }),
  );
}

export async function checkLoginPolicy(username: string | null, correlationId: string): Promise<Response | null> {
  if (!username) return null;
  const user = await getPrismaClient().user.findUnique({
    where: { username },
    select: { id: true, systemRole: true, disabledAt: true, loginLockedUntil: true },
  });
  if (!user || user.disabledAt) return null;
  if (user.loginLockedUntil && user.loginLockedUntil > new Date()) {
    await appendLoginAudit({ userId: user.id, action: "auth.login.locked", correlationId });
    return createPublicErrorResponse({ code: "AUTH_LOCKED", message: "Вход временно ограничен.", correlationId }, 429);
  }
  if (user.systemRole === "USER" && !readAuthEnvironment()?.clientAccessEnabled) {
    await appendLoginAudit({ userId: user.id, action: "auth.login.client-access-disabled", correlationId });
    return createPublicErrorResponse({ code: "AUTH_ACCESS_DISABLED", message: "Вход временно ограничен.", correlationId }, 403);
  }
  return null;
}

export async function recordLoginResult(input: { username: string | null; status: number; correlationId: string }) {
  if (!input.username) return;
  const user = await getPrismaClient().user.findUnique({
    where: { username: input.username },
    select: { id: true, failedLoginCount: true },
  });
  if (!user) return;
  if (input.status >= 200 && input.status < 300) {
    await getPrismaClient().user.update({ where: { id: user.id }, data: { failedLoginCount: 0, loginLockedUntil: null } });
    await appendLoginAudit({ userId: user.id, action: "auth.login.password-verified", correlationId: input.correlationId });
    return;
  }
  if (input.status !== 401) return;
  const failedLoginCount = user.failedLoginCount + 1;
  await getPrismaClient().user.update({
    where: { id: user.id },
    data: {
      failedLoginCount,
      loginLockedUntil: failedLoginCount >= loginFailureLimit ? new Date(Date.now() + loginLockoutMs) : null,
    },
  });
  await appendLoginAudit({
    userId: user.id,
    action: failedLoginCount >= loginFailureLimit ? "auth.login.locked" : "auth.login.failed",
    correlationId: input.correlationId,
  });
}
