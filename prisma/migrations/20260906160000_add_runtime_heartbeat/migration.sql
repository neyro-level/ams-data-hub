-- Persistent liveness signal for long-running application runtimes.
CREATE TABLE "RuntimeHeartbeat" (
  "id" TEXT NOT NULL,
  "runtime" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "heartbeatAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RuntimeHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RuntimeHeartbeat_runtime_workerId_key"
  ON "RuntimeHeartbeat"("runtime", "workerId");

CREATE INDEX "RuntimeHeartbeat_runtime_heartbeatAt_idx"
  ON "RuntimeHeartbeat"("runtime", "heartbeatAt");
