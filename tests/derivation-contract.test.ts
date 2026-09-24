import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const verifier = path.resolve("scripts/verify-derivation.mjs");
const temporaryRoots: string[] = [];

function createDerivedFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "ams-derivation-"));
  temporaryRoots.push(root);
  writeFileSync(path.join(root, "starter.identity.json"), JSON.stringify({
    schemaVersion: 1,
    mode: "derived",
    identity: {
      productName: "Atlas Portal",
      productSlug: "atlas-portal",
      publicOrigin: "https://atlas.example.com",
      serviceId: "atlas-portal",
      workerId: "atlas-portal-worker",
      databaseApplicationPrefix: "atlas-portal",
      artifactPrefix: "atlas-portal",
      repositorySlug: "atlas-portal",
      legalOperatorName: "Atlas LLC",
      legalOperatorEmail: "operator@atlas.example.com",
      legalOperatorAddress: "1 Example Street"
    }
  }, null, 2));
  writeFileSync(path.join(root, "README.md"), "Derived product only\n");
  return root;
}

function runVerifier(root: string) {
  return execFileSync(process.execPath, [verifier, "--root", root], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("copy-source derivation verifier", () => {
  it("accepts a complete derived identity without starter residue", () => {
    expect(runVerifier(createDerivedFixture())).toContain("derivation_identity=valid");
  });

  it("rejects a restored starter identity in a copied text file", () => {
    const root = createDerivedFixture();
    writeFileSync(path.join(root, "README.md"), ["АМС", "Старт"].join(" "));

    expect(() => runVerifier(root)).toThrow(/unresolved starter token/);
  });

  it("rejects an incomplete legal identity manifest", () => {
    const root = createDerivedFixture();
    const manifestPath = path.join(root, "starter.identity.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.identity.legalOperatorEmail = ["TO", "DO:", " operator"].join("");
    writeFileSync(manifestPath, JSON.stringify(manifest));

    expect(() => runVerifier(root)).toThrow(/identity\.legalOperatorEmail/);
  });
});
