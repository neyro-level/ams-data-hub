#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
EXPECTED_RELEASE_SHA="${EXPECTED_RELEASE_SHA:?Set EXPECTED_RELEASE_SHA}"
TMP_HEADERS="$(mktemp)"
TMP_BODY="$(mktemp)"
cleanup() { rm -f "${TMP_HEADERS}" "${TMP_BODY}"; }
trap cleanup EXIT

probe() {
  local path="$1"
  local expected="$2"
  local status
  status="$(curl -sS -D "${TMP_HEADERS}" -o "${TMP_BODY}" -w '%{http_code}' "${BASE_URL}${path}")"
  case ",${expected}," in *",${status},"*) ;; *) echo "unexpected_status=${path}:${status}" >&2; exit 1 ;; esac
}

probe /api/health/live 200
grep -Fq "${EXPECTED_RELEASE_SHA}" "${TMP_BODY}"
grep -Eiq '^cache-control:.*no-store' "${TMP_HEADERS}"
probe /api/health/ready 200
grep -Eiq '^cache-control:.*no-store' "${TMP_HEADERS}"
probe / 200
probe /dashboard 302,303,307,308
probe /admin 302,303,307,308
echo "live_proof=PASS"
