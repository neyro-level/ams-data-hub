import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";
import { createPrismaContext } from "../../src/platform/database/prisma/context.ts";
import { readDatabaseEnvironment } from "../../src/platform/config/server-environment.ts";

// Lower transport/startup-identity fixtures only. main, lifecycle, authorization,
// full cut, guardian and all repositories remain actual implementations.
const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });
if (target.host !== "127.0.0.1" || target.port !== 5435 || target.database !== "ams_data_hub_test")
  throw new Error("SYNTHETIC_RETENTION_DATABASE_DENIED");
const context = createPrismaContext(readDatabaseEnvironment());
if (context.pool.options.host !== target.host || context.pool.options.port !== target.port
  || context.pool.options.database !== target.database || context.pool.options.user !== target.user)
  throw new Error("SYNTHETIC_RETENTION_DATABASE_DENIED");
// Existing test-login membership, not new grants/credentials. Every connection,
// including session guardians, starts as the real NOSUPERUSER/NOBYPASS worker.
context.pool.options.options = "-c timezone=UTC -c role=ams_data_hub_worker";
const identity = await context.pool.query("SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
if (identity.rows.length !== 1 || identity.rows[0]?.role !== "ams_data_hub_worker"
  || identity.rows[0]?.rolsuper !== false || identity.rows[0]?.rolbypassrls !== false)
  throw new Error("SYNTHETIC_RETENTION_ROLE_DENIED");
Object.assign(globalThis, { prisma: context.prisma, prismaAdapter: context.adapter, prismaPool: context.pool });
const expectedHash = process.env.SYNTHETIC_RETENTION_HASH;
const bucket = process.env.SYNTHETIC_DELETE_BUCKET;
if (!expectedHash || !/^[a-f0-9]{64}$/u.test(expectedHash) || !bucket?.startsWith("synthetic-retention-"))
  throw new Error("SYNTHETIC_RETENTION_TRANSPORT_DENIED");
S3Client.prototype.send = (async (command: unknown) => {
  if (!(command instanceof DeleteObjectCommand) || command.input.Bucket !== bucket
    || command.input.Key !== `source-artifacts/${expectedHash}`)
    throw new Error("SYNTHETIC_RETENTION_TRANSPORT_DENIED");
  process.stdout.write(`${JSON.stringify({ event: "synthetic_raw_delete" })}\n`);
  if (process.env.SYNTHETIC_RETENTION_MODE === "unknown") throw new Error("SYNTHETIC_REPLY_LOST");
  return { $metadata: { httpStatusCode: 204, attempts: 1 } };
}) as typeof S3Client.prototype.send;
process.argv = [process.execPath, "src/worker/main.ts", "raw-artifact-retention", ...process.argv.slice(2)];
await import("../../src/worker/main.ts");
