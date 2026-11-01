#!/usr/bin/env bash
# Demarre DeepSeek Gateway sur Linux / macOS.
set -euo pipefail
cd "$(dirname "$0")"
exec node server.js
