$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# El Node.js embebido en dependencies/ no se distribuye en el repositorio: se
# descarga aqui si hace falta (ver scripts/ensure-node.ps1).
. (Join-Path $PSScriptRoot "ensure-node.ps1")
$node   = Get-BundledNode -DependenciesDir (Join-Path $RootDir "dependencies") -NodeVersion "22.23.1"
$NpmCmd = $node.NpmCmd

& $NpmCmd install
if (-not (Test-Path "workbench.config.json")) {
  & $NpmCmd run init-project
}

Write-Host "Configure your project instance, then authenticate and run:"
Write-Host "  copilot login --host YOUR_ENTERPRISE.ghe.com"
Write-Host "  gh auth login --hostname YOUR_ENTERPRISE.ghe.com"
Write-Host "  npm run projects"
Write-Host "  npm run doctor -- --project YOUR_PROJECT_ID"
Write-Host "  npm start -- --project YOUR_PROJECT_ID"
