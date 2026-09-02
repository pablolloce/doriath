<#
.SYNOPSIS
  Comprueba si hay una version nueva de FENIX publicada como release en GitHub
  Enterprise y muestra la descarga manual correspondiente en Artifactory.

.NOTES
  GitHub CLI ya esta autenticado por install.ps1. Artifactory requiere que cada
  usuario complete el login SSO en su navegador, por lo que este script no intenta
  descargar ni ejecutar el instalador.

  Reglas de diseno, por orden de importancia:

    1. NUNCA debe impedir que FENIX arranque. Cualquier fallo (sin red, VPN caida,
      GHE inaccesible) se traga y se sigue arrancando la version instalada. Por
      eso todo va dentro de try/catch y con timeout.
  2. No se actualiza un checkout de desarrollo. Si hay .git, el usuario gestiona
     su version con git y no queremos pisarle el arbol de trabajo.
    3. El usuario descarga e instala manualmente el EXE despues de autenticarse en
      Artifactory desde el navegador.
#>

function Get-FenixLocalVersion {
  param([Parameter(Mandatory)] [string]$RootDir)

  # BUILD.json lo genera scripts/build-dist.mjs y solo existe en instalaciones
  # empaquetadas. En un checkout de desarrollo se cae a package.json.
  $buildFile = Join-Path $RootDir "BUILD.json"
  if (Test-Path $buildFile) {
    try { return (Get-Content $buildFile -Raw | ConvertFrom-Json).version } catch {}
  }

  $manifest = Join-Path $RootDir "package.json"
  if (Test-Path $manifest) {
    try { return (Get-Content $manifest -Raw | ConvertFrom-Json).version } catch {}
  }

  return $null
}

function ConvertTo-FenixVersion {
  param([string]$Value)

  if (-not $Value) { return $null }
  # Tambien acepta una v inicial para conservar compatibilidad con versiones
  # procedentes de canales anteriores; [version] no acepta ese prefijo.
  $clean = ($Value -replace '^[vV]', '').Trim()
  # Descarta sufijos tipo "-rc1": [version] no los entiende.
  $clean = ($clean -split '[-+]')[0]
  try { return [version]$clean } catch { return $null }
}

function Get-FenixDownloadUrl {
  param(
    [Parameter(Mandatory)] [string]$RepositoryUrl,
    [Parameter(Mandatory)] [version]$Version
  )

  $installerName = "FENIX-Setup-$($Version.ToString()).exe"
  return "$($RepositoryUrl.TrimEnd('/'))/$([Uri]::EscapeDataString($installerName))"
}

function Invoke-FenixUpdateCheck {
  <#
    Siempre permite continuar el arranque. Si existe una version nueva, informa
    al usuario y muestra el enlace directo para descargarla manualmente.
  #>
  param(
    [Parameter(Mandatory)] [string]$RootDir,
    [Parameter(Mandatory)] [string]$GhExe,
    [Parameter(Mandatory)] [string]$Repo,
    [Parameter(Mandatory)] [string]$RepositoryUrl,
    [int]$TimeoutSec = 20
  )

  try {
    if ($env:FENIX_SKIP_UPDATE -eq "1") {
      return $false
    }

    # Checkout de desarrollo: fuera del alcance de la autoactualizacion.
    if (Test-Path (Join-Path $RootDir ".git")) {
      return $false
    }

    if (-not (Test-Path $GhExe)) { return $false }

    $localRaw = Get-FenixLocalVersion -RootDir $RootDir
    $local = ConvertTo-FenixVersion $localRaw
    if (-not $local) { return $false }

    Write-Host "  Comprobando actualizaciones..." -ForegroundColor Gray

    # gh puede quedarse esperando si la red esta rara; se ejecuta en segundo
    # plano con limite de tiempo para no bloquear el arranque.
    $job = Start-Job -ScriptBlock {
      param($exe, $repo)
      & $exe release view --repo $repo --json tagName 2>$null
    } -ArgumentList $GhExe, $Repo

    $completed = Wait-Job $job -Timeout $TimeoutSec
    if (-not $completed) {
      Stop-Job $job -ErrorAction SilentlyContinue
      Remove-Job $job -Force -ErrorAction SilentlyContinue
      Write-Host "  [INFO]  La comprobacion de actualizaciones ha tardado demasiado. Se continua." -ForegroundColor Gray
      return $false
    }

    try {
      $output = Receive-Job $job -ErrorAction Stop
    } finally {
      Remove-Job $job -Force -ErrorAction SilentlyContinue
    }
    if (-not $output) { return $false }

    $release = ($output -join "") | ConvertFrom-Json
    $remote = ConvertTo-FenixVersion $release.tagName
    if (-not $remote) { return $false }

    if ($remote -le $local) {
      Write-Host "  [OK]    FENIX esta actualizado (v$localRaw)." -ForegroundColor Green
      return $false
    }

    $downloadUrl = Get-FenixDownloadUrl -RepositoryUrl $RepositoryUrl -Version $remote
    Write-Host ""
    Write-Host "  [NUEVA VERSION] FENIX $remote esta disponible; tienes instalada la $localRaw." -ForegroundColor Cyan
    Write-Host "  Descargala manualmente desde Artifactory (inicia sesion en Chrome si se solicita):" -ForegroundColor Yellow
    Write-Host "  $downloadUrl" -ForegroundColor Cyan
    Write-Host "  Cierra FENIX y ejecuta el instalador descargado para actualizar." -ForegroundColor Yellow
    Write-Host ""
    return $false

  } catch {
    Write-Host "  [INFO]  No se pudo comprobar si hay actualizaciones ($($_.Exception.Message)). Se continua." -ForegroundColor Gray
    return $false
  }
}
