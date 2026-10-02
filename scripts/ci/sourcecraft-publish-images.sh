#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${SOURCECRAFT_TOKEN:?SOURCECRAFT_TOKEN is required}"
: "${RELEASE_COMMIT_SHA:?RELEASE_COMMIT_SHA is required}"
: "${VERIFIED_GATE_COMMIT_SHA:?VERIFIED_GATE_COMMIT_SHA is required}"

REGISTRY_HOST="pkg.sourcecraft.tech"
REGISTRY_PREFIX="${REGISTRY_HOST}/cr/integrator-p/cn1h8kfcah4l5sn4enbm"
ACTUAL_SHA="$(git rev-parse HEAD)"
MAIN_SHA="$(git rev-parse origin/main)"

if [[ ! "$RELEASE_COMMIT_SHA" =~ ^[0-9a-f]{40}$ || "$RELEASE_COMMIT_SHA" != "$ACTUAL_SHA" || "$RELEASE_COMMIT_SHA" != "$MAIN_SHA" ]]; then
  echo "Refusing release: exact checked-out origin/main SHA is required." >&2
  exit 1
fi
if [[ ! "$VERIFIED_GATE_COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Refusing release: verified gate SHA is invalid." >&2
  exit 1
fi
git merge-base --is-ancestor "$VERIFIED_GATE_COMMIT_SHA" "$RELEASE_COMMIT_SHA" || {
  echo "Refusing release: verified gate SHA is not an ancestor of main." >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || { echo "Docker is required on the SourceCraft worker." >&2; exit 1; }
mkdir -p .release-artifacts
workdir="$(mktemp -d)"
cleanup() {
  docker logout "$REGISTRY_HOST" >/dev/null 2>&1 || true
  rm -rf "$workdir"
}
trap cleanup EXIT

printf '%s' "$SOURCECRAFT_TOKEN" | docker login --username iam --password-stdin "$REGISTRY_HOST" >/dev/null

manifest=".release-artifacts/registry-manifest.json"
printf '{\n  "schemaVersion": 1,\n  "commitSha": "%s",\n  "images": {\n' "$RELEASE_COMMIT_SHA" > "$manifest"

roles=(web worker migrator)
targets=(runtime-web runtime-worker migrator)
for index in "${!roles[@]}"; do
  role="${roles[$index]}"
  target="${targets[$index]}"
  repository="${REGISTRY_PREFIX}/ams-data-hub-${role}"
  tag="${repository}:sha-${RELEASE_COMMIT_SHA}"
  metadata="${workdir}/${role}.json"
  docker buildx build \
    --platform linux/amd64 \
    --target "$target" \
    --label "org.opencontainers.image.revision=${RELEASE_COMMIT_SHA}" \
    --label "org.opencontainers.image.source=https://sourcecraft.dev/integrator-p/ams-data-hub" \
    --tag "$tag" \
    --metadata-file "$metadata" \
    --push .
  digest="$(node -e "const m=require(process.argv[1]);const d=m['containerimage.digest'];if(!/^sha256:[0-9a-f]{64}$/.test(d||''))process.exit(1);process.stdout.write(d)" "$metadata")"
  image_ref="${repository}@${digest}"
  docker pull --platform linux/amd64 "$image_ref" >/dev/null
  revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image_ref")"
  [[ "$revision" == "$RELEASE_COMMIT_SHA" ]] || { echo "Published ${role} revision mismatch." >&2; exit 1; }
  comma=","; [[ "$index" -eq 2 ]] && comma=""
  printf '    "%s": {"repository": "%s", "digest": "%s", "imageRef": "%s"}%s\n' "$role" "$repository" "$digest" "$image_ref" "$comma" >> "$manifest"
done

printf '  }\n}\n' >> "$manifest"
node -e "const fs=require('node:fs');const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(m.commitSha!==process.argv[2])process.exit(1);console.log('AMS_DATA_HUB_RELEASE_MANIFEST_V1='+Buffer.from(JSON.stringify(m)).toString('base64'))" "$manifest" "$RELEASE_COMMIT_SHA"
