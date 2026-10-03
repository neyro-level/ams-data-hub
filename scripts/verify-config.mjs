import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const forbiddenTokens = [
  ["AMS", String.fromCharCode(73, 77, 80, 85, 76, 83, 69)].join(" "),
  ["ИМ", "ПУЛЬС"].join(""),
  ["seo", "monitor"].join("-"),
  ["seo", "monitor"].join("_"),
  ["YAN", "DEX"].join(""),
  ["MET", "RICA"].join(""),
  ["WEB", "MASTER"].join(""),
  ["TOP", "VISOR"].join(""),
  ["SEO", "ANALYST"].join("_"),
];
const forbiddenPatterns = forbiddenTokens.map((token) => new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "node_modules",
  "playwright-report",
  "test-results",
  "coverage",
  "graphify-out",
]);
const ignoredFiles = new Set([
  "docs/AMS Data Hub Master Plan v1.md",
  "docs/AMS_DATA_HUB_MASTER_PLAN_V1.inventory.json",
]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryPath));
      continue;
    }
    if (entry.isFile() && /\.(?:cjs|css|html|js|json|md|mjs|prisma|sh|ts|tsx|yaml|yml)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

const violations = [];
for (const file of await collectFiles(root)) {
  const relativeFile = path.relative(root, file).replaceAll("\\", "/");
  if (ignoredFiles.has(relativeFile)) continue;
  const content = await readFile(file, "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      violations.push(`${relativeFile}: ${pattern.source}`);
    }
  }
}

const identityManifest = JSON.parse(await readFile(path.join(root, "project.identity.json"), "utf8"));
const expectedProductName = identityManifest.identity?.productName;
const expectedPublicOrigin = identityManifest.identity?.publicOrigin;
const expectedFaviconPath = identityManifest.identity?.faviconPath;
const rootLayout = await readFile(path.join(root, "src/app/layout.tsx"), "utf8");
if (typeof expectedProductName !== "string" || !expectedProductName.trim() || !rootLayout.includes("default: productIdentity.appName")) {
  violations.push("src/app/layout.tsx: metadata must match project.identity.json");
}
const productIdentitySource = await readFile(path.join(root, "src/platform/config/product-identity.ts"), "utf8");
for (const field of ["productName", "productSlug", "publicOrigin", "faviconPath"]) {
  if (!productIdentitySource.includes(field)) violations.push(`src/platform/config/product-identity.ts: missing ${field}`);
}
for (const literal of [expectedProductName, expectedPublicOrigin, expectedFaviconPath]) {
  if (typeof literal !== "string" || !literal.trim()) {
    violations.push("project.identity.json: application identity values must be non-empty strings");
    continue;
  }
  for (const file of await collectFiles(path.join(root, "src"))) {
    const source = await readFile(file, "utf8");
    if (source.includes(literal)) {
      violations.push(`${path.relative(root, file).replaceAll("\\", "/")}: duplicates project identity literal ${literal}`);
    }
  }
}
if (!rootLayout.includes("index: false") || !rootLayout.includes("follow: false")) {
  violations.push("src/app/layout.tsx: every surface must inherit noindex, nofollow");
}

const robotsSource = await readFile(path.join(root, "src/app/robots.ts"), "utf8");
if (!robotsSource.includes('disallow: "/"') || robotsSource.includes("sitemap")) {
  violations.push("src/app/robots.ts: robots policy must disallow the complete site without a sitemap");
}

for (const removedPath of [
  "src/app/soglasie/page.tsx",
  "src/app/cookies/page.tsx",
  "src/app/terms/page.tsx",
  "src/app/offline/page.tsx",
  "src/app/manifest.ts",
  "src/app/sitemap.ts",
  "public/sw.js",
  "src/components/pwa/ServiceWorkerRegistration.tsx",
  "src/components/marketing/LeadRequestDialog.tsx",
  "src/shared/config/public-leads-environment.ts",
  "src/shared/leads/send-lead.ts",
]) {
  if (existsSync(path.join(root, removedPath))) violations.push(`${removedPath}: removed public surface returned`);
}

if (violations.length > 0) {
  console.error(`Data Hub config verification failed:\n${violations.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log("Application config verified: product identity, noindex policy and minimal public surface.");
