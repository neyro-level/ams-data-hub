import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const schema = await readFile(path.join(root, "prisma", "schema.prisma"), "utf8");
const geoMigration = await readFile(
  path.join(root, "prisma", "migrations", "20261003222000_shared_catalog_geo", "migration.sql"),
  "utf8",
);
const entityMigration = await readFile(
  path.join(root, "prisma", "migrations", "20261003230000_shared_catalog_entities", "migration.sql"),
  "utf8",
);
const historyMigration = await readFile(
  path.join(root, "prisma", "migrations", "20261004020000_catalog_provenance_revisions", "migration.sql"),
  "utf8",
);

const failures = [];
for (const model of ["Region", "RegionAlias", "City", "CityAlias", "District", "DistrictAlias"]) {
  if (!schema.includes(`model ${model} {`)) failures.push(`missing Prisma model ${model}`);
  if (!geoMigration.includes(`ALTER TABLE "${model}" ENABLE ROW LEVEL SECURITY`)) {
    failures.push(`missing RLS for ${model}`);
  }
}
if (!geoMigration.includes("table_name || '_read'") || !geoMigration.includes("table_name || '_insert'")) {
  failures.push("missing split read/write catalog policies");
}
for (const code of ["RU-KDA", "RU-CR", "RU-SEV", "RU-ROS"]) {
  if (!geoMigration.includes(`'${code}'`)) failures.push(`missing required region seed ${code}`);
}
for (const name of ["Краснодар", "Севастополь", "Ростов-на-Дону"]) {
  if (!geoMigration.includes(`'${name}'`)) failures.push(`missing required city seed ${name}`);
}
for (const table of ["Region", "City", "District"]) {
  if (!geoMigration.includes(`CREATE TRIGGER "${table}_uid_immutable"`)) {
    failures.push(`missing immutable uid trigger for ${table}`);
  }
}
for (const model of ["Developer", "DeveloperAlias", "Development", "DevelopmentAlias", "Building", "BuildingAlias"]) {
  if (!schema.includes(`model ${model} {`)) failures.push(`missing Prisma model ${model}`);
  if (!entityMigration.includes(`ALTER TABLE "${model}" ENABLE ROW LEVEL SECURITY`)) failures.push(`missing RLS for ${model}`);
}
for (const table of ["Developer", "Development", "Building"]) {
  if (!entityMigration.includes(`CREATE TRIGGER "${table}_uid_immutable"`)) failures.push(`missing immutable uid trigger for ${table}`);
}
for (const model of ["CatalogChangeSet", "CatalogEntityVersion", "FactProvenance"]) {
  if (!schema.includes(`model ${model} {`)) failures.push(`missing Prisma model ${model}`);
  if (!historyMigration.includes(`ALTER TABLE "${model}" ENABLE ROW LEVEL SECURITY`)) failures.push(`missing RLS for ${model}`);
  if (!historyMigration.includes(`CREATE TRIGGER "${model}_immutable"`)) failures.push(`missing immutable history trigger for ${model}`);
}
if (!historyMigration.includes("'MANUAL_ADMIN'") || !historyMigration.includes("CatalogProvenanceSource")) {
  failures.push("manual provenance source is missing");
}
if ([geoMigration, entityMigration, historyMigration].some((sql) => sql.includes("GRANT DELETE"))) failures.push("runtime roles must not hard-delete shared catalog entities");
if (!geoMigration.includes("TO ams_data_hub_worker, ams_data_hub_backup") || !entityMigration.includes("TO ams_data_hub_worker, ams_data_hub_backup")) {
  failures.push("worker and backup read grants are missing");
}

if (failures.length > 0) throw new Error(`Shared catalog schema guard failed:\n${failures.join("\n")}`);
process.stdout.write("shared_catalog_schema=PASS regions=4 seeded_cities=3 entities=developer,development,building history=immutable\n");
