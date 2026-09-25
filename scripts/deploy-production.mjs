import { access, readFile } from "node:fs/promises";
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
  throw new Error(`Production deploy requires main, current branch: ${branch || "detached"}.`);
}
if (dirty.length > 0) {
  throw new Error("Production deploy requires a clean Git worktree.");
}
if (!/^[0-9a-f]{40}$/.test(commitSha)) {
  throw new Error(`Invalid commit SHA: ${commitSha}`);
}

const artifactName = `ams-start-${commitSha}.tar.gz`;
const artifactPath = path.join(rootDir, ".release-artifacts", artifactName);
const checksumPath = `${artifactPath}.sha256`;
await access(artifactPath);
await access(checksumPath);

const manifestProbe = JSON.parse(
  execFileSync("tar", ["-xOzf", artifactPath, "./release-manifest.json"], {
    cwd: rootDir,
    encoding: "utf8",
  }),
);
if (manifestProbe.commitSha !== commitSha) {
  throw new Error(`Artifact manifest SHA ${manifestProbe.commitSha} does not match main ${commitSha}.`);
}

const remote = process.env.AMS_START_DEPLOY_HOST;
if (!remote) {
  throw new Error("Set AMS_START_DEPLOY_HOST before deploying a derived production app.");
}

execFileSync("scp", [artifactPath, checksumPath, `${remote}:/tmp/`], {
  cwd: rootDir,
  stdio: "inherit",
});

const remoteScript = String.raw`
set -euo pipefail
SHA="$1"
ARTIFACT_NAME="$2"
ROOT="\${AMS_START_ROOT:-/opt/ams-platform/ams-start}"
RELEASE="$ROOT/releases/$SHA"
ARTIFACT="/tmp/$ARTIFACT_NAME"
CHECKSUM="/tmp/$ARTIFACT_NAME.sha256"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker_missing=true" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "docker_compose_missing=true" >&2
  exit 1
fi

cd /tmp
sha256sum -c "$ARTIFACT_NAME.sha256"
if [ -e "$RELEASE" ]; then
  echo "Release directory already exists: $RELEASE" >&2
  exit 1
fi
mkdir -p "$RELEASE" "$ROOT/shared"
tar -xzf "$ARTIFACT" -C "$RELEASE"

MANIFEST_FILE="$RELEASE/release-manifest.json"
read_manifest() {
  python3 -c 'import json,sys; value=json.load(open(sys.argv[1], encoding="utf-8")); [value:=value[key] for key in sys.argv[2].split(".")]; print("" if value is None else value)' "$MANIFEST_FILE" "$1"
}
MANIFEST_SHA="$(read_manifest commitSha)"
if [ "$MANIFEST_SHA" != "$SHA" ]; then
  echo "release_manifest_mismatch=true" >&2
  exit 1
fi

for ROLE in web worker migrator; do
  docker load -i "$RELEASE/${ROLE}-image.tar"
  TAG="$(read_manifest images.${ROLE}.tag)"
  EXPECTED_DIGEST="$(read_manifest images.${ROLE}.digest)"
  ACTUAL_DIGEST="$(docker image inspect "$TAG" --format '{{.Id}}')"
  if [ "$ACTUAL_DIGEST" != "$EXPECTED_DIGEST" ]; then
    echo "image_digest_mismatch=${ROLE}" >&2
    exit 1
  fi
done

WEB_TAG="$(read_manifest images.web.tag)"
WORKER_TAG="$(read_manifest images.worker.tag)"
MIGRATOR_TAG="$(read_manifest images.migrator.tag)"
WEB_DIGEST="$(read_manifest images.web.digest)"
WORKER_DIGEST="$(read_manifest images.worker.digest)"
MIGRATOR_DIGEST="$(read_manifest images.migrator.digest)"
PREVIOUS_SHA="$(read_manifest rollback.previousCommitSha)"
PREVIOUS_WEB_TAG="$(read_manifest rollback.images.web.tag 2>/dev/null || true)"
PREVIOUS_WORKER_TAG="$(read_manifest rollback.images.worker.tag 2>/dev/null || true)"
PREVIOUS_MIGRATOR_TAG="$(read_manifest rollback.images.migrator.tag 2>/dev/null || true)"
PREVIOUS_WEB_DIGEST="$(read_manifest rollback.images.web.digest 2>/dev/null || true)"
PREVIOUS_WORKER_DIGEST="$(read_manifest rollback.images.worker.digest 2>/dev/null || true)"
PREVIOUS_MIGRATOR_DIGEST="$(read_manifest rollback.images.migrator.digest 2>/dev/null || true)"

cat > "$ROOT/shared/release.env.next" <<EOF
RELEASE_SHA=$SHA
AMS_START_WEB_IMAGE=$WEB_TAG
AMS_START_WORKER_IMAGE=$WORKER_TAG
AMS_START_MIGRATOR_IMAGE=$MIGRATOR_TAG
AMS_START_WEB_IMAGE_DIGEST=$WEB_DIGEST
AMS_START_WORKER_IMAGE_DIGEST=$WORKER_DIGEST
AMS_START_MIGRATOR_IMAGE_DIGEST=$MIGRATOR_DIGEST
PREVIOUS_RELEASE_SHA=$PREVIOUS_SHA
PREVIOUS_WEB_IMAGE=$PREVIOUS_WEB_TAG
PREVIOUS_WORKER_IMAGE=$PREVIOUS_WORKER_TAG
PREVIOUS_MIGRATOR_IMAGE=$PREVIOUS_MIGRATOR_TAG
PREVIOUS_WEB_IMAGE_DIGEST=$PREVIOUS_WEB_DIGEST
PREVIOUS_WORKER_IMAGE_DIGEST=$PREVIOUS_WORKER_DIGEST
PREVIOUS_MIGRATOR_IMAGE_DIGEST=$PREVIOUS_MIGRATOR_DIGEST
EOF

docker run --rm --network host \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --env-file /etc/ams-platform/ams-start-migrator.env \
  -e APP_ENV=production \
  -e NODE_ENV=production \
  -e RELEASE_SHA="$SHA" \
  "$MIGRATOR_TAG"
mv -f "$ROOT/shared/release.env.next" "$ROOT/shared/release.env"
ln -sfn "$RELEASE" "$ROOT/current"
docker compose -f "$ROOT/current/docker-compose.production.yml" up -d web worker
curl -fsS http://127.0.0.1:3000/api/health/live | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["service"] == "ams-start"; assert payload["releaseSha"] == sys.argv[1]' "$SHA"
rm -f "$ARTIFACT" "$CHECKSUM"
`;

const deployResult = spawnSync(
  "ssh",
  ["-o", "BatchMode=yes", remote, "bash", "-s", "--", commitSha, artifactName],
  {
    cwd: rootDir,
    input: remoteScript,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  },
);
if (deployResult.status !== 0) {
  throw new Error(`Production deploy failed with status ${deployResult.status}.`);
}

const checksum = (await readFile(checksumPath, "utf8")).trim().split(/\s+/)[0];
console.log(
  JSON.stringify(
    {
      deployedSha: commitSha,
      artifact: artifactName,
      artifactSha256: checksum,
      images: manifestProbe.images,
      rollback: manifestProbe.rollback,
    },
    null,
    2,
  ),
);
