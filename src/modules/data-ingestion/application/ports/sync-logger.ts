export type SyncLogEvent =
  | {
      event: "sync_started";
      syncRunId: string;
      projectSlug: string;
      trigger: "daily" | "manual" | "preflight" | "backfill";
    }
  | {
      event: "source_run_finished";
      syncRunId: string;
      sourceRunId: string;
      siteId: string;
      provider: "YANDEX_WEBMASTER" | "YANDEX_METRIKA" | "TOPVISOR";
      durationMs: number;
      status:
        | "success"
        | "partial"
        | "failed"
        | "not_configured"
        | "access_denied"
        | "quota_limited"
        | "stale";
      safeErrorCode: string | null;
    }
  | {
      event: "sync_finished" | "sync_failed";
      syncRunId: string;
      projectSlug: string;
      durationMs: number;
      status: "success" | "partial" | "failed";
      safeErrorCode: string | null;
    };

export interface SyncLogger {
  log(event: SyncLogEvent): void;
}
