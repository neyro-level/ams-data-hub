import { NextResponse } from "next/server";
import { readReleaseSha } from "../../../../platform/config/server-environment.ts";
import { createCorrelationId } from "../../../../platform/http/correlation.ts";
import { liveHealthSchema } from "../../../../platform/http/health.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const correlationId = createCorrelationId();
  const payload = liveHealthSchema.parse({
    status: "ok",
    service: "ams-seo-monitor",
    releaseSha: readReleaseSha(),
    correlationId,
    time: new Date().toISOString(),
  });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      "X-Correlation-ID": correlationId,
    },
  });
}
