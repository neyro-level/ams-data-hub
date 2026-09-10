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

const artifactName = `ams-seo-monitor-${commitSha}.tar.gz`;
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
  throw new Error(
    `Artifact manifest SHA ${manifestProbe.commitSha} does not match main ${commitSha}.`,
  );
}

execFileSync("scp", [artifactPath, checksumPath, "ams:/tmp/"], {
  cwd: rootDir,
  stdio: "inherit",
});

const remoteScript = String.raw`
set -euo pipefail
SHA="$1"
ARTIFACT_NAME="$2"
ROOT=/opt/ams-platform/ams-seo-monitor
RELEASE="$ROOT/releases/$SHA"
ARTIFACT="/tmp/$ARTIFACT_NAME"
CHECKSUM="/tmp/$ARTIFACT_NAME.sha256"
PREVIOUS="$(readlink -f "$ROOT/current" || true)"
NGINX_LIVE=/etc/nginx/sites-available/ams-seo-monitor.conf
NGINX_BACKUP="$ROOT/shared/previous-nginx.conf"
WEB_ENV_FILE=/etc/ams-platform/ams-seo-monitor-web.env
WORKER_ENV_FILE=/etc/ams-platform/ams-seo-monitor-worker.env
MIGRATOR_ENV_FILE=/etc/ams-platform/ams-seo-monitor-migrator.env
BACKUP_ENV_FILE=/etc/ams-platform/ams-seo-monitor-backup.env
export COMPOSE_PROJECT_NAME=ams-seo-monitor
COMPOSE_FILE="$RELEASE/docker-compose.production.yml"
MANIFEST_FILE="$RELEASE/release-manifest.json"
IMAGE_TAR="$RELEASE/docker-image.tar"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker_missing=true" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "docker_compose_missing=true" >&2
  exit 1
fi
if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" = "$RELEASE" ]; then
  echo "Target release is already current; refusing in-place rebuild" >&2
  exit 1
fi

write_release_env() {
  local release_sha="$1"
  local image_tag="$2"
  local image_digest="$3"
  cat > "$ROOT/shared/release.env.next" <<EOF
RELEASE_SHA=$release_sha
AMS_SEO_MONITOR_IMAGE=$image_tag
AMS_SEO_MONITOR_IMAGE_DIGEST=$image_digest
EOF
  chown root:www-data "$ROOT/shared/release.env.next"
  chmod 0640 "$ROOT/shared/release.env.next"
  mv -f "$ROOT/shared/release.env.next" "$ROOT/shared/release.env"
}

rollback_previous() {
  systemctl stop seo-monitor-worker.service seo-monitor-outbox.service seo-monitor-web.service >/dev/null 2>&1 || true
  systemctl disable --now seo-monitor-worker.timer seo-monitor-topvisor-checks.timer seo-monitor-competitors.timer seo-monitor-outbox.timer seo-monitor-db-backup.timer >/dev/null 2>&1 || true
  if [ -n "$PREVIOUS" ]; then
    rm -f "$ROOT/current.rollback"
    ln -s "$PREVIOUS" "$ROOT/current.rollback"
    mv -Tf "$ROOT/current.rollback" "$ROOT/current"
    PREVIOUS_SHA="$(basename "$PREVIOUS")"
    PREVIOUS_IMAGE="ams-seo-monitor:$PREVIOUS_SHA"
    PREVIOUS_DIGEST="$(docker image inspect "$PREVIOUS_IMAGE" --format '{{.Id}}' 2>/dev/null || true)"
    if [[ "$PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]] && [ -n "$PREVIOUS_DIGEST" ]; then
      write_release_env "$PREVIOUS_SHA" "$PREVIOUS_IMAGE" "$PREVIOUS_DIGEST"
    fi
    if [ -f "$PREVIOUS/ops/nginx/ams-seo-monitor.conf" ]; then
      install -m 0644 "$PREVIOUS/ops/nginx/ams-seo-monitor.conf" "$NGINX_LIVE"
    elif [ -f "$NGINX_BACKUP" ]; then
      cp "$NGINX_BACKUP" "$NGINX_LIVE"
    fi
    for unit in seo-monitor-web.service seo-monitor-worker.service seo-monitor-worker.timer seo-monitor-topvisor-checks.service seo-monitor-topvisor-checks.timer seo-monitor-competitors.service seo-monitor-competitors.timer seo-monitor-outbox.service seo-monitor-outbox.timer seo-monitor-db-backup.service seo-monitor-db-backup.timer; do
      if [ -f "$PREVIOUS/ops/systemd/$unit" ]; then
        install -m 0644 "$PREVIOUS/ops/systemd/$unit" "/etc/systemd/system/$unit"
      fi
    done
    systemctl daemon-reload
    nginx -t
    systemctl reload nginx
    systemctl restart seo-monitor-web.service || true
    systemctl enable --now seo-monitor-worker.timer seo-monitor-outbox.timer seo-monitor-db-backup.timer >/dev/null 2>&1 || true
  fi
}

post_switch_rollback() {
  trap - ERR
  rollback_previous
}

run_with_env_file() {
  local env_file="$1"
  shift
  python3 - "$env_file" "$@" <<'PY'
import os
import subprocess
import sys

env_path = sys.argv[1]
command = sys.argv[2:]
env = os.environ.copy()
with open(env_path, encoding="utf-8") as handle:
    for raw_line in handle:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise SystemExit(f"Invalid env line in {env_path}: {raw_line.rstrip()}")
        key, value = line.split("=", 1)
        key = key.removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        env[key] = value
subprocess.run(command, env=env, check=True)
PY
}

cd /tmp
sha256sum -c "$ARTIFACT_NAME.sha256"
if [ -e "$RELEASE" ]; then
  echo "Release directory already exists: $RELEASE" >&2
  exit 1
fi
mkdir -p "$RELEASE"
tar -xzf "$ARTIFACT" -C "$RELEASE"

MANIFEST_SHA="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["commitSha"])' "$MANIFEST_FILE")"
IMAGE_TAG="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["imageTag"])' "$MANIFEST_FILE")"
IMAGE_DIGEST="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["imageDigest"])' "$MANIFEST_FILE")"
if [ "$MANIFEST_SHA" != "$SHA" ]; then
  echo "Release manifest mismatch" >&2
  exit 1
fi
for env_file in "$WEB_ENV_FILE" "$WORKER_ENV_FILE" "$MIGRATOR_ENV_FILE" "$BACKUP_ENV_FILE"; do
  if [ ! -f "$env_file" ]; then
    echo "Missing env file: $env_file" >&2
    exit 1
  fi
done

WORKER_DATABASE_ROLE="$(python3 - "$WORKER_ENV_FILE" <<'PY'
from pathlib import Path
from urllib.parse import urlsplit
import sys

values = {}
for raw_line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    values[key.removeprefix("export ").strip()] = value.strip().strip('"').strip("'")

runtime_role = values.get("DATABASE_USER")
if not runtime_role and values.get("DATABASE_URL"):
    runtime_role = urlsplit(values["DATABASE_URL"]).username
if not runtime_role:
    raise SystemExit("worker_database_role_missing=true")
print(runtime_role)
PY
)"
if ! [[ "$WORKER_DATABASE_ROLE" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "worker_database_role_invalid=true" >&2
  exit 1
fi

LOAD_OUTPUT="$(docker load -i "$IMAGE_TAR")"
echo "$LOAD_OUTPUT"
ACTUAL_IMAGE_ID="$(docker image inspect "$IMAGE_TAG" --format '{{.Id}}')"
if [ "$ACTUAL_IMAGE_ID" != "$IMAGE_DIGEST" ]; then
  echo "Image digest mismatch: expected $IMAGE_DIGEST, got $ACTUAL_IMAGE_ID" >&2
  exit 1
fi
export AMS_SEO_MONITOR_IMAGE="$IMAGE_TAG"
export AMS_SEO_MONITOR_IMAGE_DIGEST="$IMAGE_DIGEST"

run_with_env_file "$WEB_ENV_FILE" docker compose -f "$COMPOSE_FILE" config >/dev/null

install -m 0755 "$RELEASE/ops/postgres/backup.sh" /usr/local/bin/seo-monitor-db-backup.sh
install -m 0755 "$RELEASE/ops/postgres/restore-smoke.sh" /usr/local/bin/seo-monitor-db-restore-smoke.sh
mkdir -p /var/backups/ams-seo-monitor-postgres/{tmp,daily,weekly,monthly}
run_with_env_file "$BACKUP_ENV_FILE" runuser -u postgres -- /usr/bin/env REQUIRE_OFFSITE=true /usr/local/bin/seo-monitor-db-backup.sh >/dev/null
run_with_env_file "$BACKUP_ENV_FILE" /usr/local/bin/seo-monitor-db-restore-smoke.sh >/dev/null

run_with_env_file "$MIGRATOR_ENV_FILE" docker compose -f "$COMPOSE_FILE" run --rm -e PGBOSS_RUNTIME_ROLE="$WORKER_DATABASE_ROLE" migrate

cp "$NGINX_LIVE" "$NGINX_BACKUP"
install -m 0644 "$RELEASE/ops/nginx/ams-seo-monitor.conf" "$NGINX_LIVE"
for unit in seo-monitor-web.service seo-monitor-worker.service seo-monitor-worker.timer seo-monitor-topvisor-checks.service seo-monitor-topvisor-checks.timer seo-monitor-competitors.service seo-monitor-competitors.timer seo-monitor-outbox.service seo-monitor-outbox.timer seo-monitor-db-backup.service seo-monitor-db-backup.timer; do
  install -m 0644 "$RELEASE/ops/systemd/$unit" "/etc/systemd/system/$unit"
done

trap post_switch_rollback ERR
rm -f "$ROOT/current.next"
ln -s "$RELEASE" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
write_release_env "$SHA" "$IMAGE_TAG" "$IMAGE_DIGEST"

systemctl daemon-reload
nginx -t
systemctl reload nginx
systemctl restart seo-monitor-web.service
systemctl start seo-monitor-worker.service
systemctl enable --now seo-monitor-worker.timer seo-monitor-topvisor-checks.timer seo-monitor-competitors.timer seo-monitor-outbox.timer seo-monitor-db-backup.timer

WEB_CONTAINER_ID="$(docker compose -f "$ROOT/current/docker-compose.production.yml" ps -q web)"
WORKER_CONTAINER_ID="$(docker compose -f "$ROOT/current/docker-compose.production.yml" ps -q worker)"
[ -n "$WEB_CONTAINER_ID" ]
[ -n "$WORKER_CONTAINER_ID" ]
[ "$(docker inspect --format '{{.Image}}' "$WEB_CONTAINER_ID")" = "$IMAGE_DIGEST" ]
[ "$(docker inspect --format '{{.Image}}' "$WORKER_CONTAINER_ID")" = "$IMAGE_DIGEST" ]
curl -fsS http://127.0.0.1:3000/api/health/live | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["releaseSha"] == sys.argv[1]' "$SHA"
READINESS_CONFIRMED=false
for _attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health/ready | python3 -c 'import json,sys; payload=json.load(sys.stdin); deps=payload["dependencies"]; assert payload["releaseSha"] == sys.argv[1]; assert deps["postgresql"] == "ready"; assert deps["auth"] == "configured"; assert deps["outbox"]["status"] == "healthy"; assert deps["worker"]["status"] == "healthy"; assert deps["integrationFreshness"]["status"] == "fresh"' "$SHA"; then
    READINESS_CONFIRMED=true
    break
  fi
  sleep 2
done
[ "$READINESS_CONFIRMED" = true ]
rm -f "$ARTIFACT" "$CHECKSUM"
printf '%s\n' "$PREVIOUS" > "$ROOT/shared/previous-release.txt"
printf '%s\n' "$SHA" > "$ROOT/shared/deployed-sha.txt"
trap - ERR
`;

const deployResult = spawnSync(
  "ssh",
  ["-o", "BatchMode=yes", "ams", "bash", "-s", "--", commitSha, artifactName],
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
      productionUrl: "https://impulse.ams24.ru",
    },
    null,
    2,
  ),
);
