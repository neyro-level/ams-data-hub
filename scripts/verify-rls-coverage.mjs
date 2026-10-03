import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const schema = await readFile(path.join(rootDir, "prisma", "schema.prisma"), "utf8");
const inventory = await readFile(path.join(rootDir, "src", "platform", "database", "tenant-owned-models.ts"), "utf8");
const migration = await readFile(path.join(rootDir, "prisma", "migrations", "20261003162000_rls_v2_project_scope", "migration.sql"), "utf8");

const tenantModels = [...schema.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm)]
  .filter(([, , body]) => /\borganizationId\s+String\??/.test(body))
  .map(([, name]) => name);
const requiredModels = [...new Set(["Organization", "Member", "NotificationRead", ...tenantModels])];
const missing = requiredModels.filter((model) => !inventory.includes(`"${model}"`)
  || !migration.includes(`ALTER TABLE "${model}" ENABLE ROW LEVEL SECURITY`)
  || !migration.includes(`CREATE POLICY "${model}_rls"`));

if (missing.length > 0) {
  throw new Error(`RLS coverage is incomplete: ${missing.join(", ")}`);
}

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "generated") files.push(...await collectSourceFiles(entryPath));
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

const globalClientAllowlist = new Set([
  "src/platform/auth/auth.ts",
  "src/platform/auth/login-security.ts",
  "src/platform/database/prisma/client.ts",
  "src/platform/database/transaction.ts",
  "src/modules/identity-access/infrastructure/prisma-identity-admin-repository.ts",
  "src/modules/notifications/infrastructure/prisma-notification-repository.ts",
]);
const directClientViolations = [];
for (const file of await collectSourceFiles(path.join(rootDir, "src"))) {
  const relativePath = path.relative(rootDir, file).replaceAll("\\", "/");
  const content = await readFile(file, "utf8");
  if (content.includes("getPrismaClient(") && !globalClientAllowlist.has(relativePath)) {
    directClientViolations.push(relativePath);
  }
}

if (directClientViolations.length > 0) {
  throw new Error(
    `Protected-model access must use an authorized transaction; unexpected global Prisma client use: ${directClientViolations.join(", ")}`,
  );
}

process.stdout.write(`rls_coverage=valid models=${requiredModels.length} global_client_guard=valid\n`);
