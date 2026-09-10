import { NextResponse } from "next/server";
import { getMonitoringService } from "../../../../infrastructure/service-container.ts";
import { hasAuthConfiguration } from "../../../../modules/identity-access/server.ts";
import { getOperationalReadiness } from "../../../../modules/platform-operations/server.ts";
import { readReleaseSha } from "../../../../platform/config/server-environment.ts";
import { createCorrelationId } from "../../../../platform/http/correlation.ts";
import { createPublicErrorResponse } from "../../../../platform/http/error-envelope.ts";
import { readyHealthSchema } from "../../../../platform/http/health.ts";
import { getLogger } from "../../../../platform/observability/logger.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const correlationId = createCorrelationId();
  const logger = getLogger({ route: "health.ready", correlationId });

  try {
    if (!hasAuthConfiguration()) {
      throw new Error("Auth configuration is unavailable");
    }
    const [, readiness] = await Promise.all([
      getMonitoringService().ping(),
      getOperationalReadiness(),
    ]);

    return NextResponse.json(
      readyHealthSchema.parse({
        status: "ready",
        service: "ams-seo-monitor",
        releaseSha: readReleaseSha(),
        correlationId,
        dependencies: {
          postgresql: "ready",
          auth: "configured",
          outbox: readiness.queue,
          worker: readiness.worker,
          integrationFreshness: readiness.integrationFreshness,
        },
      }),
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Correlation-ID": correlationId,
        },
      },
    );
  } catch (error) {
    logger.error({ err: error }, "ready health failed");
    return createPublicErrorResponse(
      {
        code: "READINESS_FAILED",
        message: "Сервис временно не готов принимать запросы.",
        correlationId,
      },
      503,
    );
  }
}
