import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const images = [
  process.env.AMS_DATA_HUB_WEB_IMAGE ?? "ams-data-hub-e08-web:test",
  process.env.AMS_DATA_HUB_WORKER_IMAGE ?? "ams-data-hub-e08-worker:test",
  process.env.AMS_DATA_HUB_MIGRATOR_IMAGE ?? "ams-data-hub-e08-migrator:test",
];
mkdirSync(".local/evidence", { recursive: true });

for (const image of images) {
  const safeName = image.replace(/[^a-zA-Z0-9_.-]+/g, "-");
  const result = spawnSync("docker", ["scout", "cves", "--only-severity", "critical,high", "--format", "sarif", "--output", `.local/evidence/${safeName}.sarif`, `local://${image}`], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Docker Scout inspection failed for ${image}.`);
}

console.log(JSON.stringify({ inspectionStatus: "COMPLETED_NOT_POLICY_VERDICT", inspectedImages: images, reports: ".local/evidence/*.sarif" }, null, 2));
