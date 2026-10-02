import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReleaseManifest } from "./release-contract.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
const branch = git("branch", "--show-current");
const commitSha = git("rev-parse", "HEAD");
if (branch !== "main") throw new Error(`Release artifact must be built from main, current branch: ${branch || "detached"}.`);
if (git("status", "--porcelain")) throw new Error("Release artifact requires a clean Git worktree.");

const previousManifestPath = process.env.AMS_DATA_HUB_PREVIOUS_RELEASE_MANIFEST?.trim();
const firstRelease = process.env.AMS_DATA_HUB_FIRST_RELEASE === "true";
if (!previousManifestPath && !firstRelease) {
  throw new Error("Set AMS_DATA_HUB_PREVIOUS_RELEASE_MANIFEST, or explicitly set AMS_DATA_HUB_FIRST_RELEASE=true.");
}
const previous = previousManifestPath
  ? JSON.parse(await readFile(path.resolve(previousManifestPath), "utf8"))
  : null;

const artifactsDir = path.join(rootDir, ".release-artifacts");
const stagingDir = path.join(artifactsDir, "staging", commitSha);
const artifactName = `ams-data-hub-${commitSha}.tar.gz`;
const artifactPath = path.join(artifactsDir, artifactName);
const roles = [
  { role: "web", target: "runtime-web" },
  { role: "worker", target: "runtime-worker" },
  { role: "migrator", target: "migrator" },
];

await rm(stagingDir, { recursive: true, force: true });
await mkdir(stagingDir, { recursive: true });
await cp(path.join(rootDir, "ops"), path.join(stagingDir, "ops"), { recursive: true });
for (const file of ["docker-compose.production.yml"]) await cp(path.join(rootDir, file), path.join(stagingDir, file));

const images = {};
for (const { role, target } of roles) {
  const tag = `ams-data-hub-${role}:${commitSha}`;
  const iidPath = path.join(stagingDir, `${role}.iid`);
  const tarPath = path.join(stagingDir, `${role}-image.tar`);
  const build = spawnSync("docker", ["buildx", "build", "--platform", "linux/amd64", "--target", target, "--tag", tag, "--iidfile", iidPath, "--load", "."], { cwd: rootDir, stdio: "inherit" });
  if (build.status !== 0) throw new Error(`Docker build failed for ${role} with status ${build.status}.`);
  const save = spawnSync("docker", ["save", "--output", tarPath, tag], { cwd: rootDir, stdio: "inherit" });
  if (save.status !== 0) throw new Error(`Docker save failed for ${role} with status ${save.status}.`);
  images[role] = { tag, digest: (await readFile(iidPath, "utf8")).trim() };
}

const lockBytes = await readFile(path.join(rootDir, "pnpm-lock.yaml"));
const dependencyLockSha256 = createHash("sha256").update(lockBytes).digest("hex");
const manifest = createReleaseManifest({
  commitSha,
  createdAt: new Date().toISOString(),
  dependencyLockSha256,
  images,
  firstRelease,
  previous: previous ? { commitSha: previous.commitSha, images: previous.images } : null,
});
await writeFile(path.join(stagingDir, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const tar = spawnSync("tar", ["-czf", artifactPath, "-C", stagingDir, "."], { cwd: rootDir, encoding: "utf8" });
if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr || tar.stdout}`);
const artifactSha256 = createHash("sha256").update(await readFile(artifactPath)).digest("hex");
await writeFile(`${artifactPath}.sha256`, `${artifactSha256}  ${artifactName}\n`);
await rm(stagingDir, { recursive: true, force: true });
console.log(JSON.stringify({ artifactPath, artifactSha256, commitSha, images }, null, 2));
