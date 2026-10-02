import { access, readFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
const branch = git("branch", "--show-current");
const commitSha = git("rev-parse", "HEAD");
const originMainSha = git("rev-parse", "origin/main");
const dirty = git("status", "--porcelain");

if (branch !== "main" || commitSha !== originMainSha) {
  throw new Error("Production deploy requires the exact canonical origin/main SHA.");
}
if (dirty.length > 0) throw new Error("Production deploy requires a clean Git worktree.");
if (!/^[0-9a-f]{40}$/u.test(commitSha)) throw new Error(`Invalid commit SHA: ${commitSha}`);

const manifestPath = path.join(rootDir, ".release-artifacts", "registry-manifest.json");
const composePath = path.join(rootDir, "docker-compose.production.yml");
const liveProofPath = path.join(rootDir, "ops", "release", "live-proof.sh");
const rollbackPath = path.join(rootDir, "ops", "release", "rollback.sh");
await Promise.all([manifestPath, composePath, liveProofPath, rollbackPath].map((file) => access(file)));

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.commitSha !== commitSha) {
  throw new Error(`Registry manifest SHA ${manifest.commitSha} does not match main ${commitSha}.`);
}
for (const role of ["web", "worker", "migrator"]) {
  const image = manifest.images?.[role];
  if (!image || !/^sha256:[0-9a-f]{64}$/u.test(image.digest) || image.imageRef !== `${image.repository}@${image.digest}`) {
    throw new Error(`Invalid immutable registry identity for ${role}.`);
  }
  if (!image.repository.startsWith("pkg.sourcecraft.tech/cr/integrator-p/cn1h8kfcah4l5sn4enbm/ams-data-hub-")) {
    throw new Error(`Unexpected SourceCraft registry repository for ${role}.`);
  }
}

const remote = process.env.AMS_DATA_HUB_DEPLOY_HOST;
if (!remote) throw new Error("Set AMS_DATA_HUB_DEPLOY_HOST to the approved project SSH alias.");
const staging = `/tmp/ams-data-hub-release-${commitSha}`;

execFileSync("ssh", ["-o", "BatchMode=yes", remote, "mkdir", "-p", staging], {
  cwd: rootDir,
  stdio: "inherit",
});
execFileSync(
  "scp",
  [manifestPath, composePath, liveProofPath, rollbackPath, `${remote}:${staging}/`],
  { cwd: rootDir, stdio: "inherit" },
);

const remoteScript = String.raw`
set -euo pipefail
SHA="$1"
STAGING="$2"
ROOT="/opt/ams-data-hub"
CONFIG="/etc/ams-data-hub"
RELEASE="$ROOT/releases/$SHA"

if [ "$(id -u)" -eq 0 ]; then
  run_root() { "$@"; }
else
  sudo -n true
  run_root() { sudo -n "$@"; }
fi
docker_cmd() { run_root docker "$@"; }

command -v docker >/dev/null 2>&1 || { echo "docker_missing=true" >&2; exit 1; }
docker_cmd compose version >/dev/null
test -f "$CONFIG/registry.env" || { echo "registry_credentials_missing=true" >&2; exit 1; }
test -f "$CONFIG/migrator.env" || { echo "migrator_environment_missing=true" >&2; exit 1; }
test -f "$CONFIG/web.env" || { echo "web_environment_missing=true" >&2; exit 1; }
test -f "$CONFIG/worker.env" || { echo "worker_environment_missing=true" >&2; exit 1; }

read_manifest() {
  python3 -c 'import json,sys; value=json.load(open(sys.argv[1], encoding="utf-8")); [value:=value[key] for key in sys.argv[2].split(".")]; print(value)' "$STAGING/registry-manifest.json" "$1"
}
test "$(read_manifest commitSha)" = "$SHA"

run_root install -d -m 0755 "$ROOT/releases" "$ROOT/shared" "$RELEASE"
run_root install -m 0644 "$STAGING/docker-compose.production.yml" "$RELEASE/docker-compose.production.yml"
run_root install -m 0644 "$STAGING/registry-manifest.json" "$RELEASE/registry-manifest.json"
run_root install -m 0755 "$STAGING/live-proof.sh" "$RELEASE/live-proof.sh"
run_root install -m 0755 "$STAGING/rollback.sh" "$RELEASE/rollback.sh"

SOURCECRAFT_REGISTRY_PULL_PAT="$(run_root sed -n 's/^SOURCECRAFT_REGISTRY_PULL_PAT=//p' "$CONFIG/registry.env" | tr -d '\r')"
: "\${SOURCECRAFT_REGISTRY_PULL_PAT:?SOURCECRAFT_REGISTRY_PULL_PAT is required}"
printf '%s' "$SOURCECRAFT_REGISTRY_PULL_PAT" | docker_cmd login --username iam --password-stdin pkg.sourcecraft.tech >/dev/null
unset SOURCECRAFT_REGISTRY_PULL_PAT
trap 'docker_cmd logout pkg.sourcecraft.tech >/dev/null 2>&1 || true; rm -rf "$STAGING"' EXIT

for role in web worker migrator; do
  image_ref="$(read_manifest images.$role.imageRef)"
  case "$image_ref" in pkg.sourcecraft.tech/cr/integrator-p/cn1h8kfcah4l5sn4enbm/ams-data-hub-*@sha256:*) ;; *) echo "invalid_image_ref=$role" >&2; exit 1 ;; esac
  docker_cmd pull --platform linux/amd64 "$image_ref" >/dev/null
  revision="$(docker_cmd image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image_ref")"
  test "$revision" = "$SHA" || { echo "image_revision_mismatch=$role" >&2; exit 1; }
done

WEB_IMAGE="$(read_manifest images.web.imageRef)"
WORKER_IMAGE="$(read_manifest images.worker.imageRef)"
MIGRATOR_IMAGE="$(read_manifest images.migrator.imageRef)"
PREVIOUS_RELEASE_SHA=""
PREVIOUS_WEB_IMAGE=""
PREVIOUS_WORKER_IMAGE=""
PREVIOUS_MIGRATOR_IMAGE=""
if run_root test -f "$ROOT/shared/release.env"; then
  previous="$(run_root cat "$ROOT/shared/release.env")"
  PREVIOUS_RELEASE_SHA="$(printf '%s\n' "$previous" | sed -n 's/^RELEASE_SHA=//p')"
  PREVIOUS_WEB_IMAGE="$(printf '%s\n' "$previous" | sed -n 's/^AMS_DATA_HUB_WEB_IMAGE=//p')"
  PREVIOUS_WORKER_IMAGE="$(printf '%s\n' "$previous" | sed -n 's/^AMS_DATA_HUB_WORKER_IMAGE=//p')"
  PREVIOUS_MIGRATOR_IMAGE="$(printf '%s\n' "$previous" | sed -n 's/^AMS_DATA_HUB_MIGRATOR_IMAGE=//p')"
fi

release_env="$(mktemp)"
cat > "$release_env" <<EOF
RELEASE_SHA=$SHA
AMS_DATA_HUB_WEB_IMAGE=$WEB_IMAGE
AMS_DATA_HUB_WORKER_IMAGE=$WORKER_IMAGE
AMS_DATA_HUB_MIGRATOR_IMAGE=$MIGRATOR_IMAGE
PREVIOUS_RELEASE_SHA=$PREVIOUS_RELEASE_SHA
PREVIOUS_WEB_IMAGE=$PREVIOUS_WEB_IMAGE
PREVIOUS_WORKER_IMAGE=$PREVIOUS_WORKER_IMAGE
PREVIOUS_MIGRATOR_IMAGE=$PREVIOUS_MIGRATOR_IMAGE
EOF
run_root install -m 0600 "$release_env" "$ROOT/shared/release.env.next"
rm -f "$release_env"

docker_cmd run --rm --network host --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --env-file "$CONFIG/migrator.env" \
  -e APP_ENV=production -e NODE_ENV=production -e RELEASE_SHA="$SHA" \
  "$MIGRATOR_IMAGE"

run_root mv -f "$ROOT/shared/release.env.next" "$ROOT/shared/release.env"
run_root ln -sfn "$RELEASE" "$ROOT/current"
docker_cmd compose --env-file "$ROOT/shared/release.env" -f "$ROOT/current/docker-compose.production.yml" up -d web worker
EXPECTED_RELEASE_SHA="$SHA" "$ROOT/current/live-proof.sh"
echo "production_rollout=PASS release_sha=$SHA"
`;

const result = spawnSync(
  "ssh",
  ["-o", "BatchMode=yes", remote, "bash", "-s", "--", commitSha, staging],
  { cwd: rootDir, input: remoteScript, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] },
);
if (result.status !== 0) throw new Error(`Production deploy failed with status ${result.status}.`);

console.log(JSON.stringify({ deployedSha: commitSha, images: manifest.images }, null, 2));
