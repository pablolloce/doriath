<#
.SYNOPSIS
  Resuelve Oracle Instant Client 19c para FENIX y, con aceptacion explicita de
  su licencia, lo descarga directamente desde Oracle y verifica su SHA-256.
#>

function Get-BundledOracleClient {
  param(
    [Parameter(Mandatory)] [string]$DependenciesDir,
    [switch]$AcceptLicense
  )

  $distDir = "instantclient_19_31"
  $clientDir = Join-Path $DependenciesDir $distDir
  $ociDll = Join-Path $clientDir "oci.dll"
  if (Test-Path $ociDll) {
    return [PSCustomObject]@{
      ClientDir = $clientDir
      OciDll = $ociDll
      DistDir = $distDir
      Version = "19.31.0.0.0"
    }
  }

  if (-not $AcceptLicense) { return $null }

  $archiveName = "instantclient-basic-windows.x64-19.31.0.0.0dbru.zip"
  $archiveUrl = "https://download.oracle.com/otn_software/nt/instantclient/1931000/$archiveName"
  $expectedSha256 = "9e990e02e936fe073f05b7cb9bb95bd5163372083826e9321a9d85bff88e829d"
  $temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("fenix-oracle-" + [guid]::NewGuid().ToString("N"))
  $archivePath = Join-Path $temporaryDirectory $archiveName

  try {
    New-Item -ItemType Directory -Path $temporaryDirectory -Force | Out-Null
    Write-Host "  [INFO]  Descargando Oracle Instant Client 19.31 desde Oracle..." -ForegroundColor Gray
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing

    $actualSha256 = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $expectedSha256) {
      throw "El SHA-256 de Oracle Instant Client no coincide con el publicado por Oracle."
    }

    Expand-Archive -Path $archivePath -DestinationPath $temporaryDirectory -Force
    $extractedDirectory = Join-Path $temporaryDirectory $distDir
    if (-not (Test-Path (Join-Path $extractedDirectory "oci.dll"))) {
      throw "El paquete de Oracle Instant Client no contiene $distDir/oci.dll."
    }

    New-Item -ItemType Directory -Path $DependenciesDir -Force | Out-Null
    Remove-Item $clientDir -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item -Path $extractedDirectory -Destination $clientDir
  } catch {
    Write-Host "  [ERROR] No se pudo preparar Oracle Instant Client desde $archiveUrl." -ForegroundColor Red
    throw
  } finally {
    Remove-Item $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }

  [PSCustomObject]@{
    ClientDir = $clientDir
    OciDll = $ociDll
    DistDir = $distDir
    Version = "19.31.0.0.0"
  }
}
