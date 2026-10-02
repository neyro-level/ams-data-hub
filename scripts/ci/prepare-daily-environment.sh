#!/usr/bin/env bash
set -euo pipefail

bash scripts/ci/prepare-heavy-environment.sh
apt-get install -y --no-install-recommends python3-pip
python3 -m pip install --break-system-packages --no-cache-dir semgrep==1.173.0
