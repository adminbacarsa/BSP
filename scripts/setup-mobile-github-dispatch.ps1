# Configurar secrets para botón «Generar APK preview» (Config → App móvil)
#
# Requisitos previos:
# 1. Secret GitHub EXPO_TOKEN ya creado en:
#    https://github.com/adminbacarsa/BSP/settings/secrets/actions
# 2. PAT de GitHub con permiso Actions: Read and write sobre adminbacarsa/BSP
#    https://github.com/settings/tokens?type=beta  (fine-grained)
#    o classic con scope «repo» + «workflow»
#
# Uso (PowerShell, desde la raíz del repo):
#   $env:GITHUB_DISPATCH_TOKEN = 'github_pat_...'   # pegá tu PAT
#   powershell -ExecutionPolicy Bypass -File scripts\setup-mobile-github-dispatch.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$token = $env:GITHUB_DISPATCH_TOKEN
if (-not $token) {
  Write-Host ''
  Write-Host 'Pegá el PAT de GitHub (no se muestra) y Enter:' -ForegroundColor Cyan
  $secure = Read-Host -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if (-not $token -or $token.Trim().Length -lt 20) {
  throw 'Token vacío o demasiado corto.'
}

$tmp = Join-Path $env:TEMP ("cosp-gh-dispatch-" + [guid]::NewGuid().ToString('n') + ".txt")
try {
  Set-Content -Path $tmp -Value $token.Trim() -NoNewline -Encoding ascii
  Write-Host '→ firebase functions:secrets:set GITHUB_DISPATCH_TOKEN' -ForegroundColor Yellow
  Get-Content $tmp | firebase functions:secrets:set GITHUB_DISPATCH_TOKEN --data-file=-
  if ($LASTEXITCODE -ne 0) {
    # CLI vieja sin --data-file: fallback interactivo
    Write-Host 'Fallback: pegá el mismo token cuando Firebase lo pida.' -ForegroundColor Yellow
    firebase functions:secrets:set GITHUB_DISPATCH_TOKEN
  }
  Write-Host ''
  Write-Host 'OK. Redeploy de la function:' -ForegroundColor Green
  Write-Host '  $env:FUNCTIONS_DISCOVERY_TIMEOUT=''120''; firebase deploy --only functions:triggerMobileAppPreviewBuild --force'
} finally {
  if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}
