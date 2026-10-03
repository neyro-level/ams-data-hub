import { createPrismaContext } from "../src/platform/database/prisma/context.ts";
import {
  formatDatabaseTargetSummary,
  inspectDatabaseTarget,
} from "../src/platform/config/database-target.ts";
import { productIdentity } from "../src/platform/config/product-identity.ts";

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

export async function bootstrapDatabase() {
  const created: string[] = [];
  const organization = await database.prisma.organization.upsert({
    where: { slug: productIdentity.productSlug },
    update: {},
    create: { slug: productIdentity.productSlug, name: productIdentity.appName },
    select: { id: true },
  });
  created.push(`organization:${productIdentity.productSlug}`);

  await database.prisma.project.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: "data-hub",
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      slug: "data-hub",
      name: "Стартовый проект",
      description: "Нейтральная сущность для проверки кабинета после развёртывания.",
    },
  });
  created.push("project:data-hub");

  return { created, unchanged: 0 };
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
