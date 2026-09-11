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
MANIFEST_SHA="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["commitSha"])' "$MANIFEST_FILE")"
IMAGE_TAG="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["imageTag"])' "$MANIFEST_FILE")"
IMAGE_DIGEST="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["imageDigest"])' "$MANIFEST_FILE")"
if [ "$MANIFEST_SHA" != "$SHA" ]; then
  echo "release_manifest_mismatch=true" >&2
  exit 1
fi

docker load -i "$RELEASE/docker-image.tar"
ACTUAL_IMAGE_ID="$(docker image inspect "$IMAGE_TAG" --format '{{.Id}}')"
if [ "$ACTUAL_IMAGE_ID" != "$IMAGE_DIGEST" ]; then
  echo "image_digest_mismatch=true" >&2
  exit 1
fi

cat > "$ROOT/shared/release.env.next" <<EOF
RELEASE_SHA=$SHA
AMS_START_IMAGE=$IMAGE_TAG
AMS_START_IMAGE_DIGEST=$IMAGE_DIGEST
EOF
mv -f "$ROOT/shared/release.env.next" "$ROOT/shared/release.env"
ln -sfn "$RELEASE" "$ROOT/current"

docker compose -f "$ROOT/current/docker-compose.production.yml" run --rm migrate
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
      imageTag: manifestProbe.imageTag,
      imageDigest: manifestProbe.imageDigest,
    },
    null,
    2,
  ),
);
