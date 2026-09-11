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
  const content = await readFile(file, "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      violations.push(`${path.relative(root, file).replaceAll("\\", "/")}: ${pattern.source}`);
    }
  }
}

const manifest = await readFile(path.join(root, "src/app/manifest.ts"), "utf8");
if (!manifest.includes('name: "АМС Старт"') || !manifest.includes('display: "standalone"')) {
  violations.push("src/app/manifest.ts: PWA manifest must be installable and branded as АМС Старт");
}

const serviceWorker = await readFile(path.join(root, "public/sw.js"), "utf8");
for (const privatePath of ["/api/", "/admin/", "/dashboard/", "/notifications/"]) {
  if (!serviceWorker.includes(`"${privatePath}"`)) {
    violations.push(`public/sw.js: missing private cache exclusion ${privatePath}`);
  }
}
if (/cache\.put\(request/.test(serviceWorker) && !serviceWorker.includes("isPrivateRequest(url)")) {
  violations.push("public/sw.js: cache policy must skip private requests");
}

if (violations.length > 0) {
  console.error(`Starter config verification failed:\n${violations.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log("Starter config verified: neutral brand, removed vertical markers and safe PWA cache policy.");
