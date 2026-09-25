import { fileURLToPath } from "node:url";
import path from "node:path";

const riskyPatterns = [
  /^\.sourcecraft\//u,
  /^prisma\//u,
  /^src\/(app\/api|modules\/identity-access|platform|worker)\//u,
  /^scripts\/(ci|deploy|release|verify-release)/u,
  /(^|\/)(Dockerfile|compose[^/]*\.ya?ml)$/u,
  /(^|\/)(package\.json|pnpm-lock\.yaml|\.env(?:\..*)?)$/u,
];

export function classifyRisk(paths) {
  const normalized = paths.map((value) => value.trim().replaceAll("\\", "/")).filter(Boolean);
  if (normalized.length === 0) return { hint: "RISKY", reasons: ["no changed paths supplied"] };

  const reasons = normalized.filter((file) => riskyPatterns.some((pattern) => pattern.test(file)));
  return reasons.length > 0
    ? { hint: "RISKY", reasons }
    : { hint: "STANDARD", reasons: [] };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const paths = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : (process.env.CHANGED_PATHS ?? "").split(/[\n,]/u);
  const result = classifyRisk(paths);
  console.log(`RISK_HINT=${result.hint}`);
  if (result.reasons.length > 0) console.log(`RISK_PATHS=${result.reasons.join(",")}`);
}
