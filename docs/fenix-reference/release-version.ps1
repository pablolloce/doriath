<#
.SYNOPSIS
  Valida una version, crea su rama y abre la pull request de release.

.EXAMPLE
  npm run release -- 0.7.0 TFIT0000-001
#>

param(
  [Parameter(Mandatory, Position = 0)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,
  [Parameter(Mandatory, Position = 1)]
  [ValidatePattern('^[A-Z0-9]{2,10}-\d+$')]
  [string]$Ticket,
  [string]$Repo = "bbva.ghe.com/free/fenix",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageFile = Join-Path $RootDir "package.json"
$lockFile = Join-Path $RootDir "package-lock.json"
$dependenciesDir = Join-Path $RootDir "dependencies"
$releaseBranch = "release/$Version"
$versionChanged = $false
$committed = $false

function Invoke-Native {
  param(
    [Parameter(Mandatory)] [string]$FilePath,
    [Parameter(Mandatory)] [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath termino con codigo $LASTEXITCODE."
  }
}

function Get-LatestReleaseVersion {
  param([Parameter(Mandatory)] [string]$GhExe)

  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $json = & $GhExe release view --repo $Repo --json tagName 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    $tag = (($json -join "") | ConvertFrom-Json).tagName -replace '^[vV]', ''
    try { return [version]$tag } catch { return $null }
  } finally {
    $ErrorActionPreference = $previous
  }
}

Push-Location $RootDir
try {
  $branch = (& git branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or $branch -ne "main") {
    throw "Las releases solo se publican desde la rama main; rama actual: $branch."
  }

  $status = & git status --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw "No se pudo comprobar el estado del arbol de trabajo."
  }
  if (-not $DryRun -and $status) {
    throw "El arbol de trabajo debe estar limpio antes de publicar una version."
  }

  $currentVersion = [version]((Get-Content $packageFile -Raw | ConvertFrom-Json).version)
  $requestedVersion = [version]$Version
  if ($requestedVersion -le $currentVersion) {
    throw "La version solicitada ($Version) debe ser mayor que package.json ($currentVersion)."
  }

  $ghExe = (Get-Command gh -ErrorAction SilentlyContinue).Source
  if (-not $ghExe) {
    . (Join-Path $PSScriptRoot "ensure-gh.ps1")
    $ghExe = (Get-BundledGh -DependenciesDir $dependenciesDir).GhExe
  }

  $latestRelease = Get-LatestReleaseVersion -GhExe $ghExe
  if ($latestRelease -and $requestedVersion -le $latestRelease) {
    throw "La version solicitada ($Version) debe ser mayor que la ultima release ($latestRelease)."
  }
  if ($latestRelease) {
    $expectedVersion = [version]::new($latestRelease.Major, $latestRelease.Minor + 1, 0)
    if ($requestedVersion -ne $expectedVersion) {
      throw "La plataforma genera releases minor; la siguiente version debe ser $expectedVersion, no $Version."
    }
  }

  $remoteTag = & git ls-remote --tags origin "refs/tags/$Version"
  if ($LASTEXITCODE -ne 0) { throw "No se pudieron consultar los tags remotos." }
  if ($remoteTag) { throw "El tag $Version ya existe en origin." }

  $remoteBranch = & git ls-remote --heads origin "refs/heads/$releaseBranch"
  if ($LASTEXITCODE -ne 0) { throw "No se pudo consultar la rama remota $releaseBranch." }
  if ($remoteBranch) { throw "La rama $releaseBranch ya existe en origin." }

  Write-Host ""
  Write-Host "  FENIX - release $Version" -ForegroundColor Cyan
  Write-Host "  rama:  $branch" -ForegroundColor Gray
  Write-Host "  Jira:  $Ticket" -ForegroundColor Gray
  Write-Host "  repo:  $Repo" -ForegroundColor Gray

  if ($DryRun) {
    Write-Host "  [OK]   DryRun: version, rama, release remota y GitHub CLI validados." -ForegroundColor Green
    exit 0
  }

  $originalPackage = [System.IO.File]::ReadAllBytes($packageFile)
  $originalLock = [System.IO.File]::ReadAllBytes($lockFile)

  Invoke-Native -FilePath "git" -Arguments @("switch", "-c", $releaseBranch)

  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  Invoke-Native -FilePath $npm -Arguments @("version", $Version, "--no-git-tag-version")
  $versionChanged = $true

  Invoke-Native -FilePath $npm -Arguments @("run", "check")
  Invoke-Native -FilePath $npm -Arguments @("test")

  Invoke-Native -FilePath "git" -Arguments @("add", "package.json", "package-lock.json")
  # El cierre de la PR debe disparar Create release y, despues, el workflow del instalador.
  Invoke-Native -FilePath "git" -Arguments @("commit", "-m", "chore(release): [$Ticket] publicar $Version")
  $committed = $true
  Invoke-Native -FilePath "git" -Arguments @("push", "-u", "origin", $releaseBranch)
  Invoke-Native -FilePath $ghExe -Arguments @(
    "pr", "create",
    "--repo", $Repo,
    "--base", "main",
    "--head", $releaseBranch,
    "--title", "chore(release): [$Ticket] publicar $Version",
    "--body", "Publica FENIX $Version. Tras el merge, GitHub Actions creara el tag, el instalador Windows y su checksum SHA-256."
  )

  Write-Host ""
  Write-Host "  [OK]   PR de release creada. Tras aprobarla y fusionarla, GitHub Actions publicara $Version." -ForegroundColor Green
} catch {
  if ($versionChanged -and -not $committed) {
    [System.IO.File]::WriteAllBytes($packageFile, $originalPackage)
    [System.IO.File]::WriteAllBytes($lockFile, $originalLock)
  }
  Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  Pop-Location
}