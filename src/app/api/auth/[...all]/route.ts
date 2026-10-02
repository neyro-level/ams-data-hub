import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/modules/identity-access/server";
import { createCorrelationId } from "@/platform/http/correlation";
import { createPublicErrorResponse } from "@/platform/http/error-envelope";
import { getLogger } from "@/platform/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleAuthRequest(method: "GET" | "POST", request: Request) {
  const correlationId = createCorrelationId();
  const logger = getLogger({ route: "auth", method, correlationId });
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
