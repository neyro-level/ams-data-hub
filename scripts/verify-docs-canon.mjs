import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(resolve(root, file), "utf8");
const requireText = (file, text) => {
  if (!read(file).includes(text)) {
    throw new Error(`Documentation contract missing ${JSON.stringify(text)} in ${file}`);
  }
};

const canonical = [
  "docs/README.md",
  "docs/01_PRD.md",
  "docs/02_PRODUCT_STRUCTURE.md",
  "docs/03_ARCHITECTURE.md",
  "docs/04_BACKLOG.md",
  "docs/05_RELEASE_CHECKLIST.md",
  "docs/06_DESIGN_SYSTEM.md",
  "docs/SECURITY.md",
  "docs/ENVIRONMENT.md",
  "docs/OPERATIONS.md",
  "docs/AMS Data Hub Master Plan v1.md",
  "docs/AMS_DATA_HUB_MASTER_PLAN_V1.inventory.json",
];

for (const file of canonical) {
  if (!existsSync(resolve(root, file))) {
    throw new Error(`Missing canonical document: ${file}`);
  }
}

for (const name of [
  "01_PRD.md",
  "02_PRODUCT_STRUCTURE.md",
  "03_ARCHITECTURE.md",
  "04_BACKLOG.md",
  "05_RELEASE_CHECKLIST.md",
  "06_DESIGN_SYSTEM.md",
  "SECURITY.md",
  "ENVIRONMENT.md",
  "OPERATIONS.md",
  "AMS Data Hub Master Plan v1.md",
]) {
  requireText("docs/README.md", `\`${name}\``);
}

for (const section of [
  "## Guarantee-to-proof matrix",
  "## Known bounded exceptions",
  "## Handover and rollback",
]) {
  requireText("docs/05_RELEASE_CHECKLIST.md", section);
}

for (const section of ["## Local development", "## Production deployment", "## Recovery and restore"]) {
  requireText("docs/OPERATIONS.md", section);
}

for (const reference of ["docs/README.md", "01_PRD.md", "02_PRODUCT_STRUCTURE.md", "03_ARCHITECTURE.md", "04_BACKLOG.md"]) {
  requireText("AGENTS.md", `\`${reference}\``);
}

for (const file of [
  "docs/PRODUCT.md",
  "docs/ARCHITECTURE.md",
  "docs/MASTER_PLAN.md",
  "docs/MASTER_PLAN.inventory.json",
  "docs/DERIVATION.md",
  "docs/HANDOVER.md",
  "docs/AUTH.md",
  "docs/RUNBOOK_DEPLOY.md",
  "docs/EXTERNAL_SITE_DESIGN_SYSTEM.md",
  "docs/INTERNAL_DASHBOARD_DESIGN_SYSTEM.md",
  "docs/ops/LOCAL_DEVELOPMENT.md",
  "docs/ops/RECOVERY.md",
]) {
  if (existsSync(resolve(root, file))) {
    throw new Error(`Superseded documentation still exists: ${file}`);
  }
}

for (const text of [
  "Plan ID: AMS-DATA-HUB-IMPLEMENTATION-2026-01",
  "Status: APPROVED",
  "Production: NOT AUTHORIZED",
]) {
  requireText("docs/AMS Data Hub Master Plan v1.md", text);
}

for (const section of [
  "## PII lifecycle",
  "## Version matrix and verified exceptions",
  "https://www.postgresql.org/docs/18/ddl-rowsecurity.html",
]) {
  requireText("docs/03_ARCHITECTURE.md", section);
}

requireText("docs/DH-00_CANON_MAPPING.md", "## DH-00.2 transfer proof");
console.log("docs_canon=PASS");
