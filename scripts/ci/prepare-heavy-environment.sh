#!/usr/bin/env bash
set -euo pipefail

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
pnpm exec playwright install --with-deps chromium
