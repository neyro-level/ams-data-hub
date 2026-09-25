import { readFileSync, existsSync } from "node:fs";
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
];

for (const file of canonical) {
  if (!existsSync(resolve(root, file))) {
    throw new Error(`Missing canonical document: ${file}`);
  }
}

for (const name of ["01_PRD.md", "02_PRODUCT_STRUCTURE.md", "03_ARCHITECTURE.md", "04_BACKLOG.md", "05_RELEASE_CHECKLIST.md", "06_DESIGN_SYSTEM.md"]) {
  requireText("docs/README.md", `\`${name}\``);
}

for (const reference of ["docs/README.md", "01_PRD.md", "02_PRODUCT_STRUCTURE.md", "03_ARCHITECTURE.md", "04_BACKLOG.md"]) {
  requireText("AGENTS.md", `\`${reference}\``);
}

for (const file of ["docs/PRODUCT.md", "docs/ARCHITECTURE.md"]) {
  if (!read(file).startsWith("# Superseded")) {
    throw new Error(`Legacy document must be explicitly superseded: ${file}`);
  }
}

for (const text of [
  "Plan ID: AMS-MICROSAAS-HARDENING-2026-01",
  "Status: APPROVED",
  "Production: prohibited by this plan",
]) {
  requireText("docs/MASTER_PLAN.md", text);
}
if (!existsSync(resolve(root, "docs/MASTER_PLAN.inventory.json"))) {
  throw new Error("Missing approved Task Manager inventory: docs/MASTER_PLAN.inventory.json");
}

for (const file of [
  "docs/AUTH.md",
  "docs/DATA_MODEL.md",
  "docs/SECURITY.md",
  "docs/ENVIRONMENT.md",
  "docs/RUNBOOK_DEPLOY.md",
  "docs/EXTERNAL_SITE_DESIGN_SYSTEM.md",
  "docs/INTERNAL_DASHBOARD_DESIGN_SYSTEM.md",
  "docs/ops/LOCAL_DEVELOPMENT.md",
  "docs/ops/RECOVERY.md",
]) {
  requireText(file, "**Status:** Active extension");
}

for (const section of ["## PII lifecycle", "## Version matrix and verified exceptions", "https://www.postgresql.org/docs/18/ddl-rowsecurity.html"]) {
  requireText("docs/03_ARCHITECTURE.md", section);
}

console.log("docs_canon=PASS");
