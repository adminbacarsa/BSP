# Publica OTA Expo (EAS) en canales preview y production, en secuencia.
# Uso (desde la raíz del repo o desde apps/mobile-guardia):
#   powershell -ExecutionPolicy Bypass -File scripts/mobile-ota-channels.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/mobile-ota-channels.ps1 -ProductionOnly
#   powershell -ExecutionPolicy Bypass -File scripts/mobile-ota-channels.ps1 -PreviewOnly
#
# NO uses: npm run update:preview / update:production  ← el "/" rompe el comando.

param(
  [switch]$PreviewOnly,
  [switch]$ProductionOnly,
  [string]$Message = "gate dispositivo + push preview SA + Alertas paginacion 10 + boton web notificaciones"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $root "apps\mobile-guardia"

if (-not (Test-Path (Join-Path $appDir "package.json"))) {
  throw "No se encontro apps/mobile-guardia. Ejecuta desde el repo cronoapp."
}

Set-Location $appDir
Write-Host "cwd: $appDir" -ForegroundColor Cyan

function Invoke-Ota([string]$ScriptName) {
  Write-Host ""
  Write-Host ">>> npm run $ScriptName" -ForegroundColor Yellow
  npm run $ScriptName -- --message $Message
  if ($LASTEXITCODE -ne 0) {
    throw "Fallo $ScriptName (exit $LASTEXITCODE)"
  }
}

if ($ProductionOnly) {
  Invoke-Ota "update:production"
} elseif ($PreviewOnly) {
  Invoke-Ota "update:preview"
} else {
  Invoke-Ota "update:preview"
  Invoke-Ota "update:production"
}

Write-Host ""
Write-Host "OTA listo." -ForegroundColor Green
