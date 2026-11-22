#!/usr/bin/env bash
# blindbuild launcher for this project. Usage: .devteam/bb.sh <start|stop|halt|status|run-once|verify-rules>
# Uses the location recorded when Claude Code last started (kept fresh across plugin updates),
# else the location saved by `init` in this folder.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
record="$HOME/.devteam/plugin-root.txt"
[[ -f "$record" ]] || record="$here/plugin-root.txt"
[[ -f "$record" ]] || { echo "blindbuild: plugin location unknown. Run init again." >&2; exit 1; }
cd "$here/.."
exec node "$(tr -d '\r\n' < "$record")/scripts/cli.mjs" "$@"
