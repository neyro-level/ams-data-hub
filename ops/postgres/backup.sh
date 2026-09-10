#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${DB_NAME:-seo_monitor_prod}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/ams-seo-monitor-postgres}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${KEEP_MONTHLY:-6}"
S3_BUCKET="${S3_BUCKET:-}"
S3_ENDPOINT="${S3_ENDPOINT:-}"
S3_REGION="${S3_REGION:-ru-1}"
REQUIRE_OFFSITE="${REQUIRE_OFFSITE:-}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_DIR="${BACKUP_ROOT}/tmp"
DAILY_DIR="${BACKUP_ROOT}/daily"
WEEKLY_DIR="${BACKUP_ROOT}/weekly"
MONTHLY_DIR="${BACKUP_ROOT}/monthly"
FILENAME="${DB_NAME}-${TIMESTAMP}.dump"
DAILY_PATH="${DAILY_DIR}/${FILENAME}"
LATEST_PATH="${BACKUP_ROOT}/latest.dump"
LATEST_SHA_PATH="${BACKUP_ROOT}/latest.dump.sha256"
DAY_OF_WEEK="$(date -u +%u)"
DAY_OF_MONTH="$(date -u +%d)"

if [ "${REQUIRE_OFFSITE}" != "true" ]; then
  echo "offsite_backup_policy_invalid=true" >&2
  exit 1
fi
if [ -z "${S3_BUCKET}" ] || [ -z "${S3_ENDPOINT}" ] || [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  echo "offsite_backup_configuration_missing=true" >&2
  exit 1
fi
if ! command -v aws >/dev/null 2>&1; then
  echo "offsite_backup_client_missing=true" >&2
  exit 1
fi

mkdir -p "${TMP_DIR}" "${DAILY_DIR}" "${WEEKLY_DIR}" "${MONTHLY_DIR}"
TMP_PATH="$(mktemp "${TMP_DIR}/.${DB_NAME}.${TIMESTAMP}.XXXXXX.dump")"

cleanup() {
  rm -f "${TMP_PATH}"
}
trap cleanup EXIT

pg_dump --format=custom --file "${TMP_PATH}" "${DB_NAME}"
mv "${TMP_PATH}" "${DAILY_PATH}"
sha256sum "${DAILY_PATH}" > "${DAILY_PATH}.sha256"
sha256sum -c "${DAILY_PATH}.sha256" >/dev/null
ln -sfn "${DAILY_PATH}" "${LATEST_PATH}"
cp "${DAILY_PATH}.sha256" "${LATEST_SHA_PATH}"

if [ "${DAY_OF_WEEK}" = "7" ]; then
  cp -p "${DAILY_PATH}" "${WEEKLY_DIR}/${FILENAME}"
  cp -p "${DAILY_PATH}.sha256" "${WEEKLY_DIR}/${FILENAME}.sha256"
fi

if [ "${DAY_OF_MONTH}" = "01" ]; then
  cp -p "${DAILY_PATH}" "${MONTHLY_DIR}/${FILENAME}"
  cp -p "${DAILY_PATH}.sha256" "${MONTHLY_DIR}/${FILENAME}.sha256"
fi

prune_group() {
  local dir="$1"
  local keep="$2"
  mapfile -t files < <(find "${dir}" -maxdepth 1 -type f -name '*.dump' -printf '%P\n' | sort -r)
  local count="${#files[@]}"
  if [ "${count}" -le "${keep}" ]; then
    return 0
  fi
  local index
  for ((index=keep; index<count; index+=1)); do
    rm -f "${dir}/${files[${index}]}" "${dir}/${files[${index}]}.sha256"
  done
}

aws s3 cp "${DAILY_PATH}" "s3://${S3_BUCKET}/daily/${FILENAME}" --endpoint-url "${S3_ENDPOINT}" --region "${S3_REGION}"
aws s3 cp "${DAILY_PATH}.sha256" "s3://${S3_BUCKET}/daily/${FILENAME}.sha256" --endpoint-url "${S3_ENDPOINT}" --region "${S3_REGION}"
aws s3api head-object --bucket "${S3_BUCKET}" --key "daily/${FILENAME}" --endpoint-url "${S3_ENDPOINT}" --region "${S3_REGION}" >/dev/null
aws s3api head-object --bucket "${S3_BUCKET}" --key "daily/${FILENAME}.sha256" --endpoint-url "${S3_ENDPOINT}" --region "${S3_REGION}" >/dev/null

prune_group "${DAILY_DIR}" "${KEEP_DAILY}"
prune_group "${WEEKLY_DIR}" "${KEEP_WEEKLY}"
prune_group "${MONTHLY_DIR}" "${KEEP_MONTHLY}"

echo "backup_status=local+offsite"
echo "backup_file=${DAILY_PATH}"
echo "backup_sha256_file=${DAILY_PATH}.sha256"
