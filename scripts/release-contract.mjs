const IMAGE_ROLES = ["web", "worker", "migrator"];
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function assertCommitSha(value, label = "commitSha") {
  if (!SHA_PATTERN.test(value)) throw new Error(`${label} must be an exact 40-character Git SHA.`);
  return value;
}

export function assertImageDigest(value, label = "imageDigest") {
  if (!DIGEST_PATTERN.test(value)) throw new Error(`${label} must be an immutable sha256 digest.`);
  return value;
}

function validateImages(images, label) {
  const result = {};
  for (const role of IMAGE_ROLES) {
    const image = images?.[role];
    if (!image || typeof image.tag !== "string" || image.tag.trim().length === 0) throw new Error(`${label}.${role}.tag is required.`);
    result[role] = { tag: image.tag, digest: assertImageDigest(image.digest, `${label}.${role}.digest`) };
  }
  return result;
}

export function createReleaseManifest(input) {
  const firstRelease = input.firstRelease === true;
  const previous = input.previous ?? null;
  if (!firstRelease && !previous) throw new Error("A previous release manifest is required for deterministic rollback.");
  if (firstRelease && previous) throw new Error("A first release cannot also declare a previous release.");
  if (!HASH_PATTERN.test(input.dependencyLockSha256)) throw new Error("dependencyLockSha256 must be a sha256 hash.");
  if (Number.isNaN(Date.parse(input.createdAt))) throw new Error("createdAt must be an ISO timestamp.");

  return {
    schemaVersion: 2,
    application: "ams-data-hub",
    repository: "derived-project-required",
    source: "canonical main",
    commitSha: assertCommitSha(input.commitSha),
    createdAt: input.createdAt,
    runtime: "docker-node-v24.20.0-linux-amd64",
    artifactFormat: "tar.gz",
    dependencyLockSha256: input.dependencyLockSha256,
    images: validateImages(input.images, "images"),
    rollback: firstRelease
      ? { mode: "first-release", previousCommitSha: null, images: null }
      : {
          mode: "previous-release",
          previousCommitSha: assertCommitSha(previous.commitSha, "rollback.previousCommitSha"),
          images: validateImages(previous.images, "rollback.images"),
        },
    deploymentStrategy: "sourcecraft-registry-digest-pull-and-compose-up",
  };
}

export function validateConnectionBudget(budget) {
  if (!Number.isInteger(budget.databaseMaxConnections) || budget.databaseMaxConnections < 1) {
    throw new Error("databaseMaxConnections must be a positive integer.");
  }
  if (!Number.isInteger(budget.reservedConnections) || budget.reservedConnections < 1) {
    throw new Error("reservedConnections must be a positive integer.");
  }
  const allocations = Object.entries(budget.allocations ?? {}).map(([name, allocation]) => {
    if (!Number.isInteger(allocation.instances) || allocation.instances < 0 || !Number.isInteger(allocation.maxPerInstance) || allocation.maxPerInstance < 0) {
      throw new Error(`Invalid connection allocation: ${name}.`);
    }
    return [name, allocation.instances * allocation.maxPerInstance];
  });
  const allocatedConnections = allocations.reduce((sum, [, count]) => sum + count, 0);
  const usableConnections = budget.databaseMaxConnections - budget.reservedConnections;
  if (allocatedConnections > usableConnections) {
    throw new Error(`Connection budget exceeded: ${allocatedConnections} allocated, ${usableConnections} usable.`);
  }
  return { allocatedConnections, usableConnections, remainingConnections: usableConnections - allocatedConnections };
}
