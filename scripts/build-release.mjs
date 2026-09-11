import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const branch = execFileSync("git", ["branch", "--show-current"], {
  cwd: rootDir,
  encoding: "utf8",
}).trim();
const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: rootDir,
  encoding: "utf8",
}).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], {
  cwd: rootDir,
  encoding: "utf8",
}).trim();

if (branch !== "main") {
  throw new Error(`Release artifact must be built from main, current branch: ${branch || "detached"}.`);
}
if (dirty.length > 0) {
  throw new Error("Release artifact requires a clean Git worktree.");
}
if (!/^[0-9a-f]{40}$/.test(commitSha)) {
  throw new Error(`Invalid commit SHA: ${commitSha}`);
}

const artifactsDir = path.join(rootDir, ".release-artifacts");
const stagingDir = path.join(artifactsDir, "staging", commitSha);
const artifactName = `ams-start-${commitSha}.tar.gz`;
const artifactPath = path.join(artifactsDir, artifactName);
const imageTag = `ams-start:${commitSha}`;
const imageTarPath = path.join(stagingDir, "docker-image.tar");
const imageIidPath = path.join(stagingDir, "image.iid");

await rm(stagingDir, { recursive: true, force: true });
await mkdir(stagingDir, { recursive: true });

for (const directory of ["ops"]) {
  await cp(path.join(rootDir, directory), path.join(stagingDir, directory), { recursive: true });
}
for (const file of [
  ".dockerignore",
  "Dockerfile",
  "docker-compose.production.yml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
]) {
  await cp(path.join(rootDir, file), path.join(stagingDir, file));
}

const buildResult = spawnSync(
  "docker",
  [
    "buildx",
    "build",
    "--platform",
    "linux/amd64",
    "--tag",
    imageTag,
    "--iidfile",
    imageIidPath,
    "--load",
    ".",
  ],
  { cwd: rootDir, encoding: "utf8", stdio: "inherit" },
);
if (buildResult.status !== 0) {
  throw new Error(`docker buildx build failed with status ${buildResult.status}.`);
}

const saveResult = spawnSync("docker", ["save", "--output", imageTarPath, imageTag], {
  cwd: rootDir,
  encoding: "utf8",
  stdio: "inherit",
});
if (saveResult.status !== 0) {
  throw new Error(`docker save failed with status ${saveResult.status}.`);
}

const lockBytes = await readFile(path.join(rootDir, "pnpm-lock.yaml"));
const dependencyLockSha256 = createHash("sha256").update(lockBytes).digest("hex");
const imageDigest = (await readFile(imageIidPath, "utf8")).trim();
const manifest = {
  application: "ams-start",
  repository: "template-local",
  source: "canonical main",
  commitSha,
  createdAt: new Date().toISOString(),
  runtime: "docker-node-v24.20.0-linux-amd64",
  artifactFormat: "tar.gz",
  imageTag,
  imageDigest,
  dependencyLockSha256,
  deploymentStrategy: "build-off-host-load-image-and-compose-up",
};

await writeFile(
  path.join(stagingDir, "release-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

const tarResult = spawnSync("tar", ["-czf", artifactPath, "-C", stagingDir, "."], {
  cwd: rootDir,
  encoding: "utf8",
});
if (tarResult.status !== 0) {
  throw new Error(`tar failed: ${tarResult.stderr || tarResult.stdout}`);
}

const artifactBytes = await readFile(artifactPath);
const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
await writeFile(`${artifactPath}.sha256`, `${artifactSha256}  ${artifactName}\n`, "utf8");
await rm(stagingDir, { recursive: true, force: true });

console.log(
  JSON.stringify(
    {
      artifactPath,
      artifactSha256,
      commitSha,
      dependencyLockSha256,
      imageTag,
      imageDigest,
    },
    null,
    2,
  ),
);
