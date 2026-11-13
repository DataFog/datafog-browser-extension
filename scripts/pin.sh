#!/usr/bin/env bash
# Read pinned tool versions from repository root files.
# Usage: scripts/pin.sh <tool>
#   tools: node
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

case "${1:-}" in
    node)
        cat "$REPO_ROOT/.nvmrc" | tr -d '[:space:]'
        ;;
    *)
        echo "Usage: $0 <node>" >&2
        exit 1
        ;;
esac
