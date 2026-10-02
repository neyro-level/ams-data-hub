import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fullShaPattern = /^[0-9a-f]{40}$/;

export function verifyExactHead(expectedValue, actualValue) {
  const expectedSha = expectedValue?.trim();
  const actualSha = actualValue?.trim();

  if (!expectedSha || !fullShaPattern.test(expectedSha)) {
    throw new Error("EXPECTED_COMMIT_SHA must be a full lowercase 40-character Git SHA.");
  }
  if (!actualSha || !fullShaPattern.test(actualSha)) {
    throw new Error("Git HEAD must resolve to a full lowercase 40-character Git SHA.");
  }
  if (actualSha !== expectedSha) {
    throw new Error(`Exact-head mismatch: expected ${expectedSha}, got ${actualSha}.`);
  }

  return actualSha;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const actualSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const verifiedSha = verifyExactHead(process.env.EXPECTED_COMMIT_SHA, actualSha);
  console.log(`Exact-head verified: ${verifiedSha}`);
}
