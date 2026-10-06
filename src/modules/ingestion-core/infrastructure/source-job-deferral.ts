import "server-only";
import type { PgBoss, JobWithMetadata } from "pg-boss";
import { SOURCE_IMPORT_QUEUE, sourceImportJobSchema, sourceJobKey, type SourceImportJob } from "../domain/source-jobs.ts";

/** pg-boss 12 active-job deferral: one atomic project-owned SQL transition.
 * Keep the original retry count; clearing started_on prevents fetch from
 * charging contention as another execution retry. No terminal-state window. */
export async function deferSourceImportJob(boss: Pick<PgBoss, "getDb">, job: JobWithMetadata<SourceImportJob>): Promise<void> {
  const payload = sourceImportJobSchema.parse(job.data);
  if (!/^[a-f0-9-]{36}$/u.test(job.id) || !(job.startedOn instanceof Date)
    || !Number.isInteger(job.retryCount) || job.retryCount < 0) throw new Error("SOURCE_JOB_LEASE_INVALID");
  const result = await boss.getDb().executeSql(`
    UPDATE pgboss.job SET state = 'created', start_after = clock_timestamp() + interval '30 seconds',
      keep_until = GREATEST(keep_until, clock_timestamp() + interval '1 hour'),
      started_on = NULL, heartbeat_on = NULL, completed_on = NULL,
      output = '{"status":"DEFERRED","code":"SOURCE_EXECUTION_BUSY"}'::jsonb
    WHERE name = $1 AND id = $2::uuid AND state = 'active' AND retry_count = $3
      AND date_trunc('milliseconds', started_on) = $4::timestamptz
      AND data = $5::jsonb AND singleton_key = $6 RETURNING id`,
  [SOURCE_IMPORT_QUEUE, job.id, job.retryCount, job.startedOn.toISOString(), JSON.stringify(payload), sourceJobKey(payload.sourceId)]);
  if (result.rows.length !== 1) throw new Error("SOURCE_JOB_LEASE_LOST");
}
