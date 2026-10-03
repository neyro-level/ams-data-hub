import { readFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const schema = await readFile(path.join(rootDir, "prisma", "schema.prisma"), "utf8");
const migration = await readFile(path.join(rootDir, "prisma", "migrations", "20261003194000_identity_contracts", "migration.sql"), "utf8");
const projectOwnedModels = ["Organization", "Member", "Project", "Notification", "AuditEvent", "IdempotencyKey", "OutboxEvent", "JobRun", "RuntimeHeartbeat", "RetentionRun", "PublicUrlIdReservation"];

for (const modelName of projectOwnedModels) {
  const model = new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`, "u").exec(schema)?.[1];
  if (!model || !/^\s*id\s+String\s+@id\s+@default\(cuid\(\)\)/mu.test(model)) {
    throw new Error(`Project-owned model ${modelName} must use a Prisma cuid id`);
  }
}
for (const required of ["PublicUrlIdReservation_subjectUid_check", "PublicUrlIdReservation_publicUrlId_check", "PublicUrlIdReservation_immutable", "PublicUrlIdReservation_rls", "GRANT SELECT, INSERT ON TABLE \"PublicUrlIdReservation\" TO ams_data_hub_web"]) {
  if (!migration.includes(required)) throw new Error(`Identity migration misses ${required}`);
}
process.stdout.write(`identity_contracts=PASS project_models=${projectOwnedModels.length}\n`);
