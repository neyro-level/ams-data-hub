#!/usr/bin/env bash
set -euo pipefail

if [[ "${INTEGRATION_TEST_FILES:-}" == "none" ]]; then
  echo "PostgreSQL preparation: skipped (no DB-scoped integration proof)"
  exit 0
fi

for name in TEST_DATABASE_USER TEST_DATABASE_PASSWORD TEST_DATABASE_NAME; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment value: ${name}" >&2
    exit 1
  fi
done

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
. /etc/os-release
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update
apt-get install -y --no-install-recommends postgresql-18
pg_ctlcluster 18 main start
runuser -u postgres -- psql -v ON_ERROR_STOP=1 \
  --command "CREATE ROLE ${TEST_DATABASE_USER} LOGIN PASSWORD '${TEST_DATABASE_PASSWORD}' CREATEDB"
runuser -u postgres -- createdb --owner "${TEST_DATABASE_USER}" "${TEST_DATABASE_NAME}"
