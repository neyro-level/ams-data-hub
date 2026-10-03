import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const sourceDir = path.join(rootDir, "src");
const failures = [];
const removedModulePaths = [
  ["data", "ingestion"].join("-"),
  ["rank", "ing", "analytics"].join("-"),
  ["report", "ing"].join(""),
].map((moduleName) => `src/modules/${moduleName}`);
const moduleMapNames = [
  "identity-access",
  "notifications",
  "platform-admin",
  "platform-operations",
  "project-registry",
  "shared-catalog",
  "project-state",
  "media-assets",
  "snapshot-delivery",
  "ingestion-core",
  "operations-control",
];

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
  "src/platform/http/safe-outbound.ts",
  "src/platform/http/safe-outbound-core.ts",
  "src/platform/security/secret-ref.ts",
  "src/platform/security/sensitive-redaction.ts",
]) {
  try {
    await readFile(path.join(rootDir, relativePath));
  } catch {
    failures.push(`Missing required platform boundary: ${relativePath}`);
  }
}

const architecture = await readFile(path.join(rootDir, "docs/03_ARCHITECTURE.md"), "utf8");
const dependencyRules = await readFile(path.join(rootDir, "dependency-cruiser.config.cjs"), "utf8");
for (const moduleName of moduleMapNames) {
  if (!architecture.includes(`| \`${moduleName}\``)) {
    failures.push(`Module Map misses ownership boundary: ${moduleName}`);
  }
  if (!dependencyRules.includes(`"${moduleName}"`)) {
    failures.push(`Dependency guard misses module boundary: ${moduleName}`);
  }
}

const modulesDirectory = path.join(sourceDir, "modules");
for (const entry of await readdir(modulesDirectory, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const moduleDirectory = path.join(modulesDirectory, entry.name);
  const codeFiles = await collectFiles(moduleDirectory);
  if (codeFiles.length === 0) {
    failures.push(`Empty module scaffold is forbidden: src/modules/${entry.name}`);
  }
  const rootFiles = await readdir(moduleDirectory, { withFileTypes: true });
  if (!rootFiles.some((file) => file.isFile() && /^(?:actions|client|contracts|index|presentation|server|worker)\.(?:ts|tsx)$/.test(file.name))) {
    failures.push(`Module has no explicit public boundary: src/modules/${entry.name}`);
  }
}

for (const relativePath of [
  "src/app/admin/_actions/identity.ts",
  "src/app/admin/_actions/projects.ts",
  "src/app/admin/_actions/operations.ts",
  "src/app/admin/_components/IdentityAdminForms.tsx",
  "src/app/admin/_components/ProjectAdminForms.tsx",
  "src/app/admin/_components/OperationsAdminForms.tsx",
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
  ...removedModulePaths,
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
  if (
    /^\s*["']use client["'];/m.test(source)
    && /(?:platform\/security|security\/secret-ref|security\/sensitive-redaction)/.test(source)
  ) {
    failures.push(`Client boundary imports server-only secret code: ${relativePath}`);
  }
  if (
    !/^src\/platform\/http\/safe-outbound(?:-core)?\.ts$/.test(relativePath)
    && (
      /\bfetch\s*\(/.test(source)
      || /from\s+["']node:(?:dns|http|https|tls)["']/.test(source)
      || (relativePath !== "src/platform/config/server-environment.ts" && /from\s+["']node:net["']/.test(source))
      || /from\s+["'](?:axios|got|undici)(?:\/|["'])/.test(source)
    )
  ) {
    failures.push(`Remote HTTP bypasses Safe Outbound: ${relativePath}`);
  }
  if (
    source.includes("defineCommand({")
    && (
      /\bfetch\s*\(/.test(source)
      || /from\s+["']node:(?:fs|http|https|net|tls)["']/.test(source)
      || /from\s+["'](?:axios|nodemailer|stripe)(?:\/|["'])/.test(source)
    )
  ) {
    failures.push(`External I/O inside command boundary: ${relativePath}`);
  }
  if (
    /^src\/modules\/[^/]+\/infrastructure\/prisma-.*-repository\.ts$/.test(relativePath)
    && source.includes("runInPrincipalDatabaseTransaction")
  ) {
    failures.push(`Repository opens a nested principal transaction: ${relativePath}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Architecture guard failed:\n${failures.join("\n")}`);
}

process.stdout.write("architecture_static_guards=valid\n");
