# blindbuild launcher for this project. Usage: .devteam\bb.ps1 <start|stop|halt|status|run-once|verify-rules>
# Uses the location recorded when Claude Code last started (kept fresh across plugin updates),
# else the location saved by `init` in this folder.
$record = @((Join-Path $HOME '.devteam\plugin-root.txt'), (Join-Path $PSScriptRoot 'plugin-root.txt')) |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $record) { Write-Error 'blindbuild: plugin location unknown. Run init again.'; exit 1 }
$root = (Get-Content $record -Raw).Trim()
Push-Location (Split-Path $PSScriptRoot -Parent)
try { node (Join-Path $root 'scripts/cli.mjs') @args; exit $LASTEXITCODE } finally { Pop-Location }
