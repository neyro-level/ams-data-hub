ALTER TABLE "User"
  ALTER COLUMN "disabledAt" TYPE timestamptz(3) USING "disabledAt" AT TIME ZONE 'UTC';

ALTER TABLE "UserSetupToken"
  ALTER COLUMN "expiresAt" TYPE timestamptz(3) USING "expiresAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "usedAt" TYPE timestamptz(3) USING "usedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "revokedAt" TYPE timestamptz(3) USING "revokedAt" AT TIME ZONE 'UTC';

ALTER TABLE "SyncRun"
  ALTER COLUMN "startedAt" TYPE timestamptz(3) USING "startedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "finishedAt" TYPE timestamptz(3) USING "finishedAt" AT TIME ZONE 'UTC';

ALTER TABLE "SourceRun"
  ALTER COLUMN "startedAt" TYPE timestamptz(3) USING "startedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "finishedAt" TYPE timestamptz(3) USING "finishedAt" AT TIME ZONE 'UTC';

ALTER TABLE "RankingCapture"
  ALTER COLUMN "capturedAt" TYPE timestamptz(3) USING "capturedAt" AT TIME ZONE 'UTC';

ALTER TABLE "TechnicalSnapshot"
  ALTER COLUMN "capturedAt" TYPE timestamptz(3) USING "capturedAt" AT TIME ZONE 'UTC';

ALTER TABLE "ReportSnapshot"
  ALTER COLUMN "generatedAt" TYPE timestamptz(3) USING "generatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "IdempotencyKey"
  ALTER COLUMN "expiresAt" TYPE timestamptz(3) USING "expiresAt" AT TIME ZONE 'UTC';

ALTER TABLE "OutboxEvent"
  ALTER COLUMN "lockedAt" TYPE timestamptz(3) USING "lockedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "processedAt" TYPE timestamptz(3) USING "processedAt" AT TIME ZONE 'UTC';

ALTER TABLE "JobRun"
  ALTER COLUMN "startedAt" TYPE timestamptz(3) USING "startedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "finishedAt" TYPE timestamptz(3) USING "finishedAt" AT TIME ZONE 'UTC';

ALTER TABLE "RuntimeHeartbeat"
  ALTER COLUMN "startedAt" TYPE timestamptz(3) USING "startedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "heartbeatAt" TYPE timestamptz(3) USING "heartbeatAt" AT TIME ZONE 'UTC';

ALTER TABLE "RetentionRun"
  ALTER COLUMN "startedAt" TYPE timestamptz(3) USING "startedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "finishedAt" TYPE timestamptz(3) USING "finishedAt" AT TIME ZONE 'UTC';
