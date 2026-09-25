import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const patterns = [
  { name: "private key", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { name: "SourceCraft token", expression: /\bpv1_[A-Za-z0-9_-]{30,}\b/u },
  { name: "GitHub token", expression: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u },
  { name: "AWS access key", expression: /\bAKIA[0-9A-Z]{16}\b/u },
  { name: "Slack token", expression: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u },
];

export function scanText(text) {
  return patterns.filter(({ expression }) => expression.test(text)).map(({ name }) => name);
}

export function trackedFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
}

export function scanFiles(files) {
  const findings = [];
  for (const file of files) {
    const absolutePath = path.resolve(file);
    if (statSync(absolutePath).size > 1024 * 1024) continue;
    const text = readFileSync(absolutePath, "utf8");
    for (const kind of scanText(text)) findings.push({ file, kind });
  }
  return findings;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const findings = scanFiles(trackedFiles());
  if (findings.length > 0) {
    for (const finding of findings) console.error(`Potential ${finding.kind}: ${finding.file}`);
    process.exit(1);
  }
  console.log("Secret scan: PASS");
}
