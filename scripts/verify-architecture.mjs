import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const sourceDir = path.join(rootDir, "src");
const failures = [];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!entryPath.includes(`${path.sep}generated${path.sep}`)) {
        files.push(...(await collectFiles(entryPath)));
      }
    } else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

for (const relativePath of [
  "src/platform/database/prisma/client.ts",
  "src/platform/database/prisma/context.ts",
  "src/platform/database/transaction.ts",
  "src/platform/database/tenant-owned-models.ts",
  "src/platform/commands/define-command.ts",
  "src/platform/actions/define-action.ts",
]) {
  try {
    await readFile(path.join(rootDir, relativePath));
  } catch {
    failures.push(`Missing required platform boundary: ${relativePath}`);
  }
}

for (const relativePath of [
  "src/app/admin/_actions/goals.ts",
  "src/app/admin/_actions/providers.ts",
  "src/app/admin/_actions/query-clusters.ts",
  "src/app/admin/_actions/sites.ts",
  "src/app/admin/_actions/thresholds.ts",
  "src/app/admin/_actions/tracked-queries.ts",
  "src/app/admin/_components/GoalDefinitionAdminForms.tsx",
  "src/app/admin/_components/ProviderConnectionAdminForms.tsx",
  "src/app/admin/_components/QueryClusterProfileAdminForms.tsx",
  "src/app/admin/_components/SiteAdminForms.tsx",
  "src/app/admin/_components/ThresholdProfileAdminForms.tsx",
  "src/app/admin/_components/TrackedQuerySetAdminForms.tsx",
]) {
  try {
    await readFile(path.join(rootDir, relativePath));
  } catch {
    failures.push(`Missing bounded Platform Admin adapter: ${relativePath}`);
  }
}

for (const relativePath of [
  "src/app/admin/actions.ts",
  "src/app/admin/_components/RegistryAdminForms.tsx",
  "src/modules/export/.gitkeep",
  "src/modules/metrica-analytics/.gitkeep",
  "src/modules/seo-opportunities/.gitkeep",
  "src/modules/webmaster-analytics/.gitkeep",
]) {
  try {
    await readFile(path.join(rootDir, relativePath));
    failures.push(`Obsolete architecture placeholder: ${relativePath}`);
  } catch {
    // Absence is the required state.
  }
}

for (const filePath of await collectFiles(sourceDir)) {
  const source = await readFile(filePath, "utf8");
  const relativePath = path.relative(rootDir, filePath).replaceAll("\\", "/");
  if (source.includes('from "@prisma/client"') || source.includes("from '@prisma/client'")) {
    failures.push(`Legacy generated Prisma import: ${relativePath}`);
  }
  if (/\$queryRawUnsafe\s*\(/.test(source) || /\$executeRawUnsafe\s*\(/.test(source)) {
    failures.push(`Unsafe raw SQL: ${relativePath}`);
  }
  if (source.includes("infrastructure/database/prisma")) {
    failures.push(`Legacy database boundary import: ${relativePath}`);
  }
  if (source.includes("ActorContext")) {
    failures.push(`Legacy authorization context: ${relativePath}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Architecture guard failed:\n${failures.join("\n")}`);
}

process.stdout.write("architecture_static_guards=valid\n");
