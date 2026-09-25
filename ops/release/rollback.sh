#!/usr/bin/env bash
set -euo pipefail

ROOT="${AMS_START_ROOT:-/opt/ams-platform/ams-start}"
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

for role in WEB WORKER MIGRATOR; do
  image_var="PREVIOUS_${role}_IMAGE"
  digest_var="PREVIOUS_${role}_IMAGE_DIGEST"
  image="${!image_var}"
  expected="${!digest_var}"
  actual="$(docker image inspect "${image}" --format '{{.Id}}')"
  test "${actual}" = "${expected}" || { echo "rollback_digest_mismatch=${role}" >&2; exit 1; }
done

test -d "${ROOT}/releases/${PREVIOUS_RELEASE_SHA}" || { echo "previous_release_directory_missing=true" >&2; exit 1; }
echo "rollback is application-only; database migrations must be forward-compatible" >&2
CURRENT_RELEASE_SHA="${RELEASE_SHA}"
CURRENT_WEB_IMAGE="${AMS_START_WEB_IMAGE}"
CURRENT_WORKER_IMAGE="${AMS_START_WORKER_IMAGE}"
CURRENT_MIGRATOR_IMAGE="${AMS_START_MIGRATOR_IMAGE}"
CURRENT_WEB_DIGEST="${AMS_START_WEB_IMAGE_DIGEST}"
CURRENT_WORKER_DIGEST="${AMS_START_WORKER_IMAGE_DIGEST}"
CURRENT_MIGRATOR_DIGEST="${AMS_START_MIGRATOR_IMAGE_DIGEST}"
cat > "${ROOT}/shared/release.env.next" <<EOF
RELEASE_SHA=${PREVIOUS_RELEASE_SHA}
AMS_START_WEB_IMAGE=${PREVIOUS_WEB_IMAGE}
AMS_START_WORKER_IMAGE=${PREVIOUS_WORKER_IMAGE}
AMS_START_MIGRATOR_IMAGE=${PREVIOUS_MIGRATOR_IMAGE}
AMS_START_WEB_IMAGE_DIGEST=${PREVIOUS_WEB_IMAGE_DIGEST}
AMS_START_WORKER_IMAGE_DIGEST=${PREVIOUS_WORKER_IMAGE_DIGEST}
AMS_START_MIGRATOR_IMAGE_DIGEST=${PREVIOUS_MIGRATOR_IMAGE_DIGEST}
PREVIOUS_RELEASE_SHA=${CURRENT_RELEASE_SHA}
PREVIOUS_WEB_IMAGE=${CURRENT_WEB_IMAGE}
PREVIOUS_WORKER_IMAGE=${CURRENT_WORKER_IMAGE}
PREVIOUS_MIGRATOR_IMAGE=${CURRENT_MIGRATOR_IMAGE}
PREVIOUS_WEB_IMAGE_DIGEST=${CURRENT_WEB_DIGEST}
PREVIOUS_WORKER_IMAGE_DIGEST=${CURRENT_WORKER_DIGEST}
PREVIOUS_MIGRATOR_IMAGE_DIGEST=${CURRENT_MIGRATOR_DIGEST}
EOF
mv -f "${ROOT}/shared/release.env.next" "${ROOT}/shared/release.env"
ln -sfn "${ROOT}/releases/${PREVIOUS_RELEASE_SHA}" "${ROOT}/current"
docker compose -f "${ROOT}/current/docker-compose.production.yml" up -d web worker
echo "rollback_status=PASS"
