#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${DB_NAME:-ams_data_hub_prod}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/ams-data-hub-postgres}"
BACKUP_FILE="${BACKUP_FILE:-${BACKUP_ROOT}/latest.dump}"
RESTORE_DB="ams_data_hub_restore_smoke"
MIN_PROJECT_COUNT="${MIN_PROJECT_COUNT:-1}"
RESTORE_CONTAINER="ams-data-hub-restore-smoke"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:18.6-bookworm}"
RESTORE_USER="restore"
RESTORE_PASSWORD="restore-local-only"
CONTAINER_BACKUP_FILE="/source.dump"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "missing_backup=${BACKUP_FILE}" >&2
  exit 1
fi
BACKUP_FILE_RESOLVED="$(readlink -f -- "${BACKUP_FILE}")"
if [ -z "${BACKUP_FILE_RESOLVED}" ] || [ ! -f "${BACKUP_FILE_RESOLVED}" ]; then
  echo "invalid_backup_target=true" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "restore_docker_missing=true" >&2
  exit 1
fi

cleanup() {
  docker rm -f "${RESTORE_CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker run -d --rm \
  --name "${RESTORE_CONTAINER}" \
  -e POSTGRES_USER="${RESTORE_USER}" \
  -e POSTGRES_PASSWORD="${RESTORE_PASSWORD}" \
  -e POSTGRES_DB=postgres \
  -v "${BACKUP_FILE_RESOLVED}:${CONTAINER_BACKUP_FILE}:ro" \
  "${POSTGRES_IMAGE}" >/dev/null

RESTORE_READY=false
for _ in $(seq 1 90); do
  if [ "$(docker inspect --format '{{.State.Running}}' "${RESTORE_CONTAINER}" 2>/dev/null || echo false)" != "true" ]; then
    echo "restore_container_stopped=true" >&2
    exit 1
  fi

  if docker logs "${RESTORE_CONTAINER}" 2>&1 | grep -Fq 'PostgreSQL init process complete; ready for start up.' \
    && docker exec "${RESTORE_CONTAINER}" pg_isready -U "${RESTORE_USER}" -d postgres >/dev/null 2>&1; then
    RESTORE_READY=true
    break
  fi
  sleep 1
done

if [ "${RESTORE_READY}" != "true" ]; then
  echo "restore_database_not_ready=true" >&2
  exit 1
fi

docker exec "${RESTORE_CONTAINER}" createdb -U "${RESTORE_USER}" "${RESTORE_DB}"
docker exec "${RESTORE_CONTAINER}" pg_restore --clean --if-exists --no-owner --no-privileges -U "${RESTORE_USER}" -d "${RESTORE_DB}" "${CONTAINER_BACKUP_FILE}"

MIGRATION_COUNT="$(docker exec "${RESTORE_CONTAINER}" psql -U "${RESTORE_USER}" -At -d "${RESTORE_DB}" -c 'select count(*) from "_prisma_migrations"' 2>/dev/null || echo 0)"
PROJECT_TABLE="$(docker exec "${RESTORE_CONTAINER}" psql -U "${RESTORE_USER}" -At -d "${RESTORE_DB}" -c "select to_regclass('public.\"Project\"') is not null")"
PROJECT_COUNT="$(docker exec "${RESTORE_CONTAINER}" psql -U "${RESTORE_USER}" -At -d "${RESTORE_DB}" -c 'select count(*) from "Project"')"

if [ "${MIGRATION_COUNT}" -lt 1 ]; then
  echo "restore_migrations_missing=${MIGRATION_COUNT}" >&2
  exit 1
fi
if [ "${PROJECT_TABLE}" != "t" ]; then
  echo "restore_tables_missing=project:${PROJECT_TABLE}" >&2
  exit 1
fi
if [ "${PROJECT_COUNT}" -lt "${MIN_PROJECT_COUNT}" ]; then
  echo "restore_row_sanity_failed=project:${PROJECT_COUNT}" >&2
  exit 1
fi

echo "restore_status=ok"
echo "restore_db=${RESTORE_DB}"
echo "restore_migration_count=${MIGRATION_COUNT}"
echo "restore_project_count=${PROJECT_COUNT}"
echo "source_backup=${BACKUP_FILE}"
