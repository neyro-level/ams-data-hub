import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const forbidden = [
  ["star", "ter"].join(""),
  ["micro", "saas"].join(""),
  ["copy", "-source"].join(""),
  ["der", "ived"].join(""),
  ["neu", "tral"].join(""),
  ["deriva", "tion"].join(""),
];
const ignored = new Set(["CHANGELOG.md", "pnpm-lock.yaml"]);
const tracked = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
}).split("\0").filter(Boolean);
const violations = [];

for (const file of tracked) {
  const normalized = file.replaceAll("\\", "/");
  if (
    normalized.startsWith("docs/")
    || normalized.startsWith("prisma/migrations/")
    || ignored.has(normalized)
    || !existsSync(file)
  ) continue;
  const source = readFileSync(file);
  if (source.includes(0)) continue;
  const text = `${normalized}\n${source.toString("utf8")}`.toLowerCase();
  for (const token of forbidden) {
    if (text.includes(token)) violations.push(`${normalized}: ${token}`);
  }
}

if (violations.length) {
  throw new Error(`Template traces remain:\n${violations.map((item) => `- ${item}`).join("\n")}`);
}

console.log(`template_traces=PASS files=${tracked.length} changelog_exception=observed`);
