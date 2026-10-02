import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const verifier = path.resolve("scripts/verify-derivation.mjs");
const repositoryRoot = path.resolve(".");
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
    },
    derivation: {
      sourceRepository: "https://git.sourcecraft.dev/clean-room/atlas-portal.git",
      defaultBranch: "main",
      deliveryProfile: "COMMERCIAL",
      migrationOwner: "atlas-portal",
      optionalModules: {
        outboxPlusQueue: "enabled",
        pwa: "enabled",
        platformAdmin: "disabled"
      }
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

function replaceStarterIdentity(value: string) {
  return value
    .replaceAll("https://data-hab.ams24.ru", "https://atlas.example.com")
    .replaceAll("ams-data-hub", "atlas-portal")
    .replaceAll("ams-data-hub-favicon", "atlas-portal-favicon")
    .replaceAll("AMS_DATA_HUB", "ATLAS_PORTAL")
    .replaceAll("ams_data_hub", "atlas_portal")
    .replaceAll("ams-data-hub", "atlas-portal")
    .replaceAll("AMS Data Hub", "Atlas Portal")
    .replaceAll("TODO:", "Configured:")
    .replaceAll("DELIVERY_PROFILE = CRITICAL", "DELIVERY_PROFILE = COMMERCIAL");
}

function createCleanRoomDerivedCopy() {
  const root = mkdtempSync(path.join(tmpdir(), "ams-derivation-clean-room-"));
  temporaryRoots.push(root);
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).split("\0").filter(Boolean);

  for (const relativePath of files) {
    if (!existsSync(path.join(repositoryRoot, relativePath))) continue;
    const destination = path.join(root, replaceStarterIdentity(relativePath));
    mkdirSync(path.dirname(destination), { recursive: true });
    const source = path.join(repositoryRoot, relativePath);
    const contents = readFileSync(source);
    if (contents.includes(0)) {
      copyFileSync(source, destination);
    } else {
      writeFileSync(destination, replaceStarterIdentity(contents.toString("utf8")));
    }
  }

  const manifestPath = path.join(root, "starter.identity.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.mode = "derived";
  manifest.derivation = {
    sourceRepository: "https://git.sourcecraft.dev/clean-room/atlas-portal.git",
    defaultBranch: "main",
    deliveryProfile: "COMMERCIAL",
    migrationOwner: "atlas-portal",
    optionalModules: {
      outboxPlusQueue: "enabled",
      pwa: "enabled",
      platformAdmin: "disabled"
    }
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return root;
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

  it("rejects starter database identities in SQL migrations", () => {
    const root = createCleanRoomDerivedCopy();
    const sqlPath = path.join(root, "prisma", "migrations", "identity.sql");
    mkdirSync(path.dirname(sqlPath), { recursive: true });
    writeFileSync(sqlPath, ["CREATE ROLE ams", "start", "web;"].join("_"));

    expect(() => runVerifier(root)).toThrow(/unresolved starter token/u);
  }, 30_000);

  it("rejects an incomplete legal identity manifest", () => {
    const root = createDerivedFixture();
    const manifestPath = path.join(root, "starter.identity.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.identity.legalOperatorEmail = ["TO", "DO:", " operator"].join("");
    writeFileSync(manifestPath, JSON.stringify(manifest));

    expect(() => runVerifier(root)).toThrow(/identity\.legalOperatorEmail/);
  });

  it("rejects an undecided optional-module contract", () => {
    const root = createDerivedFixture();
    const manifestPath = path.join(root, "starter.identity.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.derivation.optionalModules.outboxPlusQueue = "UNDECIDED";
    writeFileSync(manifestPath, JSON.stringify(manifest));

    expect(() => runVerifier(root)).toThrow(/optionalModules\.outboxPlusQueue/);
  });

  it("passes a clean-room copied starter and rejects one restored source token", () => {
    const root = createCleanRoomDerivedCopy();

    expect(runVerifier(root)).toContain("derivation_identity=valid");
    writeFileSync(path.join(root, "README.md"), ["ams", "start"].join("-"));
    expect(() => runVerifier(root)).toThrow(/unresolved starter token/);
  }, 30_000);
});
