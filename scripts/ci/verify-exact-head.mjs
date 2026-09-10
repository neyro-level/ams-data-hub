import { execFileSync } from "node:child_process";

const expectedSha = process.env.EXPECTED_COMMIT_SHA?.trim();

if (!expectedSha || !/^[0-9a-f]{40}$/.test(expectedSha)) {
  throw new Error("EXPECTED_COMMIT_SHA must be a full lowercase 40-character Git SHA.");
}

const actualSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

if (actualSha !== expectedSha) {
  throw new Error(`Exact-head mismatch: expected ${expectedSha}, got ${actualSha}.`);
}

console.log(`Exact-head verified: ${actualSha}`);
