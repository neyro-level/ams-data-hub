import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const schema = await readFile(path.join(root, "prisma", "schema.prisma"), "utf8");
const migration = await readFile(
  path.join(root, "prisma", "migrations", "20261003222000_shared_catalog_geo", "migration.sql"),
  "utf8",
);

const failures = [];
for (const model of ["Region", "RegionAlias", "City", "CityAlias", "District", "DistrictAlias"]) {
  if (!schema.includes(`model ${model} {`)) failures.push(`missing Prisma model ${model}`);
  if (!migration.includes(`ALTER TABLE "${model}" ENABLE ROW LEVEL SECURITY`)) {
    failures.push(`missing RLS for ${model}`);
  }
}
if (!migration.includes("table_name || '_read'") || !migration.includes("table_name || '_insert'")) {
  failures.push("missing split read/write catalog policies");
}
for (const code of ["RU-KDA", "RU-CR", "RU-SEV", "RU-ROS"]) {
  if (!migration.includes(`'${code}'`)) failures.push(`missing required region seed ${code}`);
}
for (const name of ["Краснодар", "Севастополь", "Ростов-на-Дону"]) {
  if (!migration.includes(`'${name}'`)) failures.push(`missing required city seed ${name}`);
}
for (const table of ["Region", "City", "District"]) {
  if (!migration.includes(`CREATE TRIGGER "${table}_uid_immutable"`)) {
    failures.push(`missing immutable uid trigger for ${table}`);
  }
}
if (migration.includes("GRANT DELETE")) failures.push("runtime roles must not hard-delete catalog geo");
if (!migration.includes("TO ams_data_hub_worker, ams_data_hub_backup")) {
  failures.push("worker and backup read grants are missing");
}

if (failures.length > 0) throw new Error(`Shared catalog schema guard failed:\n${failures.join("\n")}`);
process.stdout.write("shared_catalog_schema=PASS regions=4 seeded_cities=3 districts=admin_owned\n");
