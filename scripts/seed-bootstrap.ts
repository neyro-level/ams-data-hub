import { createPrismaContext } from "../src/platform/database/prisma/context.ts";
import {
  formatDatabaseTargetSummary,
  inspectDatabaseTarget,
} from "../src/platform/config/database-target.ts";

const databaseEnvironment = {
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_HOST: process.env.DATABASE_HOST,
  DATABASE_PORT: process.env.DATABASE_PORT,
  DATABASE_USER: process.env.DATABASE_USER,
  DATABASE_PASSWORD: process.env.DATABASE_PASSWORD,
  DATABASE_NAME: process.env.DATABASE_NAME,
  DATABASE_SSLMODE: process.env.DATABASE_SSLMODE,
  APP_ENV: process.env.APP_ENV,
  NODE_ENV: process.env.NODE_ENV,
};
const target = inspectDatabaseTarget(databaseEnvironment);
console.error(`database_target=${formatDatabaseTargetSummary(target)}`);
const database = createPrismaContext(databaseEnvironment);

const DEFAULT_THRESHOLD_PROFILE = {
  slug: "default",
  minimumShows: 30,
  maximumCtrPercent: "5",
  maximumAveragePosition: "10",
  showsDropPercent: "30",
  clicksDropPercent: "30",
  positionWorsenedDelta: "2",
  pagesInSearchDropPercent: "10",
  organicVisitsDropPercent: "30",
  goalConversionDropPercent: "20",
} as const;

export async function bootstrapDatabase() {
  const created: string[] = [];

  const threshold = await database.prisma.thresholdProfile.findUnique({
    where: { slug: DEFAULT_THRESHOLD_PROFILE.slug },
    select: { id: true },
  });
  if (!threshold) {
    await database.prisma.thresholdProfile.create({ data: DEFAULT_THRESHOLD_PROFILE });
    created.push("threshold-profile:default");
  }

  const cluster = await database.prisma.queryClusterProfile.findUnique({
    where: { slug: "default" },
    select: { id: true },
  });
  if (!cluster) {
    await database.prisma.queryClusterProfile.create({
      data: { slug: "default", name: "Базовый" },
    });
    created.push("query-cluster-profile:default");
  }

  return { created, unchanged: 2 - created.length };
}

bootstrapDatabase()
  .then((result) => {
    console.log(JSON.stringify({ mode: "bootstrap", ...result }, null, 2));
  })
  .finally(async () => {
    await database.close();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Database bootstrap failed");
    process.exit(1);
  });
