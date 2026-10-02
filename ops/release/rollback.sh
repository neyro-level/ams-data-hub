#!/usr/bin/env bash
set -euo pipefail

ROOT="${AMS_DATA_HUB_ROOT:-/opt/ams-data-hub}"
ENV_FILE="${ROOT}/shared/release.env"
test -f "${ENV_FILE}" || { echo "release_env_missing=true" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a
: "${PREVIOUS_RELEASE_SHA:?No previous release is recorded}"
: "${PREVIOUS_WEB_IMAGE:?Missing previous web image}"
: "${PREVIOUS_WORKER_IMAGE:?Missing previous worker image}"
: "${PREVIOUS_MIGRATOR_IMAGE:?Missing previous migrator image}"

for image in "${PREVIOUS_WEB_IMAGE}" "${PREVIOUS_WORKER_IMAGE}" "${PREVIOUS_MIGRATOR_IMAGE}"; do
  case "${image}" in pkg.sourcecraft.tech/*@sha256:*) ;; *) echo "rollback_image_not_immutable=true" >&2; exit 1 ;; esac
  docker pull "${image}" >/dev/null
  revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "${image}")"
  test "${revision}" = "${PREVIOUS_RELEASE_SHA}" || { echo "rollback_revision_mismatch=true" >&2; exit 1; }
done

test -d "${ROOT}/releases/${PREVIOUS_RELEASE_SHA}" || { echo "previous_release_directory_missing=true" >&2; exit 1; }
echo "rollback is application-only; database migrations must be forward-compatible" >&2
CURRENT_RELEASE_SHA="${RELEASE_SHA}"
CURRENT_WEB_IMAGE="${AMS_DATA_HUB_WEB_IMAGE}"
CURRENT_WORKER_IMAGE="${AMS_DATA_HUB_WORKER_IMAGE}"
CURRENT_MIGRATOR_IMAGE="${AMS_DATA_HUB_MIGRATOR_IMAGE}"
cat > "${ROOT}/shared/release.env.next" <<EOF
RELEASE_SHA=${PREVIOUS_RELEASE_SHA}
AMS_DATA_HUB_WEB_IMAGE=${PREVIOUS_WEB_IMAGE}
AMS_DATA_HUB_WORKER_IMAGE=${PREVIOUS_WORKER_IMAGE}
AMS_DATA_HUB_MIGRATOR_IMAGE=${PREVIOUS_MIGRATOR_IMAGE}
PREVIOUS_RELEASE_SHA=${CURRENT_RELEASE_SHA}
PREVIOUS_WEB_IMAGE=${CURRENT_WEB_IMAGE}
PREVIOUS_WORKER_IMAGE=${CURRENT_WORKER_IMAGE}
PREVIOUS_MIGRATOR_IMAGE=${CURRENT_MIGRATOR_IMAGE}
EOF
mv -f "${ROOT}/shared/release.env.next" "${ROOT}/shared/release.env"
ln -sfn "${ROOT}/releases/${PREVIOUS_RELEASE_SHA}" "${ROOT}/current"
docker compose --env-file "${ROOT}/shared/release.env" -f "${ROOT}/current/docker-compose.production.yml" up -d web worker
echo "rollback_status=PASS release_sha=${PREVIOUS_RELEASE_SHA}"
