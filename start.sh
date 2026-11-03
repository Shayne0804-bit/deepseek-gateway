#!/usr/bin/env bash
# Demarre VALARIA Gateway API sur Linux / macOS.
set -euo pipefail
cd "$(dirname "$0")"
exec node server.js

