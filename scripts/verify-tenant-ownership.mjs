import { Client } from "pg";
import { inspectDatabaseTarget } from "../src/platform/config/database-target.ts";

inspectDatabaseTarget(process.env);

const connection = {
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT ?? "5432"),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: process.env.DATABASE_SSLMODE === "require" ? { rejectUnauthorized: true } : undefined,
};

const requiredEnvironment = [
  "DATABASE_HOST",
  "DATABASE_USER",
  "DATABASE_PASSWORD",
  "DATABASE_NAME",
];

const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
if (missingEnvironment.length > 0) {
  throw new Error(
    `Missing required database environment: ${missingEnvironment.join(", ")}.`,
  );
}

const ownershipChecks = [
  {
    name: "Site.organizationId",
    query: 'SELECT COUNT(*)::int AS count FROM "Site" WHERE "organizationId" IS NULL',
  },
  {
    name: "Site.project",
    query: 'SELECT COUNT(*)::int AS count FROM "Site" AS child JOIN "Project" AS parent ON parent.id = child."projectId" WHERE child."organizationId" <> parent."organizationId"',
  },
  {
    name: "ProviderConnection.organizationId",
    query: 'SELECT COUNT(*)::int AS count FROM "ProviderConnection" WHERE "organizationId" IS NULL',
  },
  {
    name: "ProviderConnection.site",
    query: 'SELECT COUNT(*)::int AS count FROM "ProviderConnection" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"',
  },
  {
    name: "GoalDefinition.organizationId",
    query: 'SELECT COUNT(*)::int AS count FROM "GoalDefinition" WHERE "organizationId" IS NULL',
  },
  {
    name: "GoalDefinition.project",
    query: 'SELECT COUNT(*)::int AS count FROM "GoalDefinition" AS child JOIN "Project" AS parent ON parent.id = child."projectId" WHERE child."organizationId" <> parent."organizationId"',
  },
  {
    name: "GoalDefinitionSite.organizationId",
    query: 'SELECT COUNT(*)::int AS count FROM "GoalDefinitionSite" WHERE "organizationId" IS NULL',
  },
  {
    name: "GoalDefinitionSite.goalDefinition",
    query: 'SELECT COUNT(*)::int AS count FROM "GoalDefinitionSite" AS child JOIN "GoalDefinition" AS parent ON parent.id = child."goalDefinitionId" WHERE child."organizationId" <> parent."organizationId"',
  },
  {
    name: "GoalDefinitionSite.site",
    query: 'SELECT COUNT(*)::int AS count FROM "GoalDefinitionSite" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"',
  },
  {
    name: "TrackedQuerySet.organizationId",
    query: 'SELECT COUNT(*)::int AS count FROM "TrackedQuerySet" WHERE "organizationId" IS NULL',
  },
  {
    name: "TrackedQuerySet.site",
    query: 'SELECT COUNT(*)::int AS count FROM "TrackedQuerySet" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"',
  },
  {
    name: "TrackedQuery.organizationId",
    query: 'SELECT COUNT(*)::int AS count FROM "TrackedQuery" WHERE "organizationId" IS NULL',
  },
  {
    name: "TrackedQuery.querySet",
    query: 'SELECT COUNT(*)::int AS count FROM "TrackedQuery" AS child JOIN "TrackedQuerySet" AS parent ON parent.id = child."trackedQuerySetId" WHERE child."organizationId" <> parent."organizationId"',
  },
  {
    name: "SyncRun.organizationId",
    query: 'SELECT COUNT(*)::int AS count FROM "SyncRun" WHERE "organizationId" IS NULL',
  },
  {
    name: "SourceRun.organizationId",
    query: 'SELECT COUNT(*)::int AS count FROM "SourceRun" WHERE "organizationId" IS NULL',
  },
  {
    name: "SourceRun.syncRun",
    query: 'SELECT COUNT(*)::int AS count FROM "SourceRun" AS child JOIN "SyncRun" AS parent ON parent.id = child."syncRunId" WHERE child."organizationId" <> parent."organizationId"',
  },
  {
    name: "SourceRun.site",
    query: 'SELECT COUNT(*)::int AS count FROM "SourceRun" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"',
  },
  ...[
    "WebmasterDailyMetric",
    "WebmasterQueryDailyMetric",
    "MetrikaDailyMetric",
    "LandingPageDailyMetric",
    "MetrikaDeviceDailyMetric",
    "MetrikaGoalDailyMetric",
    "TechnicalSnapshot",
  ].flatMap((table) => [
    {
      name: `${table}.organizationId`,
      query: `SELECT COUNT(*)::int AS count FROM "${table}" WHERE "organizationId" IS NULL`,
    },
    {
      name: `${table}.site`,
      query: `SELECT COUNT(*)::int AS count FROM "${table}" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"`,
    },
    {
      name: `${table}.sourceRun`,
      query: `SELECT COUNT(*)::int AS count FROM "${table}" AS child JOIN "SourceRun" AS parent ON parent.id = child."sourceRunId" WHERE child."organizationId" <> parent."organizationId"`,
    },
  ]),
  {
    name: "RankingCapture.organizationId",
    query: 'SELECT COUNT(*)::int AS count FROM "RankingCapture" WHERE "organizationId" IS NULL',
  },
  {
    name: "RankingCapture.trackedQuery",
    query: 'SELECT COUNT(*)::int AS count FROM "RankingCapture" AS child JOIN "TrackedQuery" AS parent ON parent.id = child."trackedQueryId" WHERE child."organizationId" <> parent."organizationId"',
  },
  {
    name: "RankingCapture.sourceRun",
    query: 'SELECT COUNT(*)::int AS count FROM "RankingCapture" AS child JOIN "SourceRun" AS parent ON parent.id = child."sourceRunId" WHERE child."sourceRunId" IS NOT NULL AND child."organizationId" <> parent."organizationId"',
  },
  {
    name: "ReportSnapshot.organizationId",
    query: 'SELECT COUNT(*)::int AS count FROM "ReportSnapshot" WHERE "organizationId" IS NULL',
  },
  {
    name: "ReportSnapshot.site",
    query: 'SELECT COUNT(*)::int AS count FROM "ReportSnapshot" AS child JOIN "Site" AS parent ON parent.id = child."siteId" WHERE child."organizationId" <> parent."organizationId"',
  },
];

const client = new Client(connection);
await client.connect();

try {
  const checks = [];

  for (const { name, query } of ownershipChecks) {
    const result = await client.query(query);
    checks.push({ name, count: Number(result.rows[0]?.count ?? 0) });
  }
  const failures = checks.filter(({ count }) => count > 0);

  console.log(JSON.stringify({ checks, failures }, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
