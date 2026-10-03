import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/modules/identity-access/server";
import { createCorrelationId } from "@/platform/http/correlation";
import { readAuthEnvironment } from "@/platform/config/server-environment";
import { getPrismaClient } from "@/platform/database/prisma/client";
import { createPublicErrorResponse } from "@/platform/http/error-envelope";
import { getLogger } from "@/platform/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginFailureLimit = 10;
const loginLockoutMs = 15 * 60 * 1000;

async function getUsernameFromLoginRequest(request: Request): Promise<string | null> {
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
  await getPrismaClient().auditEvent.create({
    data: {
      actorType: "SYSTEM",
      actorId: input.userId,
      action: input.action,
      entityType: "User",
      entityId: input.userId,
      source: "auth",
      correlationId: input.correlationId,
    },
  });
}

async function checkLoginPolicy(username: string | null, correlationId: string): Promise<Response | null> {
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

async function recordLoginResult(input: { username: string | null; status: number; correlationId: string }) {
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

async function handleAuthRequest(method: "GET" | "POST", request: Request) {
  const correlationId = createCorrelationId();
  const logger = getLogger({ route: "auth", method, correlationId });
  const username = await getUsernameFromLoginRequest(request);
  const policyResponse = await checkLoginPolicy(username, correlationId);
  if (policyResponse) return policyResponse;
  const auth = getAuth();
  if (!auth) {
    logger.error("auth service unavailable");
    return createPublicErrorResponse(
      {
        code: "AUTH_UNAVAILABLE",
        message: "Сервис авторизации временно недоступен.",
        correlationId,
      },
      503,
    );
  }

  const handlers = toNextJsHandler(auth);
  const response = await (method === "GET" ? handlers.GET : handlers.POST)(request);
  await recordLoginResult({ username, status: response.status, correlationId });
  response.headers.set("X-Correlation-ID", correlationId);
  if (request.headers.get("x-correlation-id") !== correlationId) {
    response.headers.set("Vary", "X-Correlation-ID");
  }
  return response;
}

export function GET(request: Request) {
  return handleAuthRequest("GET", request);
}

export function POST(request: Request) {
  return handleAuthRequest("POST", request);
}
