import { createHash, randomUUID } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

type Environment = Record<string, string | undefined>;

interface TestStorageConfiguration {
  endpoint: string;
  region: string;
  bucketA: string;
  bucketB: string;
  clientA: S3Client;
  clientB: S3Client;
}

function requireNonBlank(env: Environment, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required for the explicit Timeweb S3 isolation test`);
  return value;
}

function parseEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("S3_TEST_ENDPOINT must be an HTTPS origin");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
    throw new Error("S3_TEST_ENDPOINT must be an HTTPS origin without credentials or path");
  }
  return endpoint;
}

function createClient(endpoint: URL, region: string, accessKeyId: string, secretAccessKey: string): S3Client {
  return new S3Client({
    endpoint: endpoint.origin,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

function readConfiguration(env: Environment): TestStorageConfiguration {
  if (env.TIMEWEB_S3_ISOLATION_TEST !== "nonproduction") {
    throw new Error("TIMEWEB_S3_ISOLATION_TEST must equal nonproduction; this runner never targets production");
  }

  const endpoint = parseEndpoint(requireNonBlank(env, "S3_TEST_ENDPOINT"));
  const region = requireNonBlank(env, "S3_TEST_REGION");
  const bucketA = requireNonBlank(env, "S3_TEST_BUCKET_A");
  const bucketB = requireNonBlank(env, "S3_TEST_BUCKET_B");
  const accessKeyIdA = requireNonBlank(env, "S3_TEST_ACCESS_KEY_ID_A");
  const secretAccessKeyA = requireNonBlank(env, "S3_TEST_SECRET_ACCESS_KEY_A");
  const accessKeyIdB = requireNonBlank(env, "S3_TEST_ACCESS_KEY_ID_B");
  const secretAccessKeyB = requireNonBlank(env, "S3_TEST_SECRET_ACCESS_KEY_B");

  if (bucketA === bucketB) throw new Error("S3_TEST_BUCKET_A and S3_TEST_BUCKET_B must differ");
  if (accessKeyIdA === accessKeyIdB) throw new Error("Test credentials A and B must differ");

  return {
    endpoint: endpoint.origin,
    region,
    bucketA,
    bucketB,
    clientA: createClient(endpoint, region, accessKeyIdA, secretAccessKeyA),
    clientB: createClient(endpoint, region, accessKeyIdB, secretAccessKeyB),
  };
}

function isAccessDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "AccessDenied" || candidate.$metadata?.httpStatusCode === 403;
}

async function expectCredentialADenied(clientA: S3Client, bucketB: string, key: string): Promise<void> {
  try {
    await clientA.send(new GetObjectCommand({ Bucket: bucketB, Key: key }));
  } catch (error) {
    if (isAccessDenied(error)) return;
    throw error;
  }
  throw new Error("Credential A unexpectedly read the fixture in bucket B");
}

async function main(): Promise<void> {
  const configuration = readConfiguration(process.env);
  const runId = randomUUID().replaceAll("-", "");
  const projectId = `s3isolation_${runId}`;
  const body = Buffer.from(JSON.stringify({ contract: "timeweb-s3-isolation", runId }), "utf8");
  const sha256 = createHash("sha256").update(body).digest("hex");
  const key = `snapshots/${projectId}/${sha256}`;
  let fixtureWritten = false;
  let cleanupPassed = false;

  try {
    await configuration.clientB.send(new PutObjectCommand({
      Bucket: configuration.bucketB,
      Key: key,
      Body: body,
      ContentType: "application/json",
    }));
    fixtureWritten = true;

    await expectCredentialADenied(configuration.clientA, configuration.bucketB, key);

    const ownerResponse = await configuration.clientB.send(new GetObjectCommand({
      Bucket: configuration.bucketB,
      Key: key,
    }));
    if (!ownerResponse.Body) throw new Error("Credential B read returned no fixture body");
    const ownerBody = await ownerResponse.Body.transformToByteArray();
    if (!Buffer.from(ownerBody).equals(body)) throw new Error("Credential B read a fixture body mismatch");
  } finally {
    if (fixtureWritten) {
      await configuration.clientB.send(new DeleteObjectCommand({
        Bucket: configuration.bucketB,
        Key: key,
      }));
      cleanupPassed = true;
    }
  }

  if (!cleanupPassed) throw new Error("Timeweb S3 isolation fixture cleanup did not complete");
  process.stdout.write(`${JSON.stringify({
    check: "timeweb_s3_credential_isolation",
    environment: "nonproduction",
    credential_A_read_bucket_B: "DENIED",
    credential_B_read_bucket_B: "PASS",
    fixture_cleanup: "PASS",
    object_sha256: sha256,
  })}\n`);
}

await main();
