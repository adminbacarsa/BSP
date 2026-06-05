# Sube AFIP_CUIT, AFIP_CERT y AFIP_PRIVATE_KEY a Secret Manager y redeploy lookupClientByCuit.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\setup-afip-secrets.ps1 -CertDir scripts\afip-csr-20217563519

param(
  [Parameter(Mandatory = $true)]
  [string]$CertDir,
  [switch]$SkipDeploy,
  [ValidateSet('true', 'false')]
  [string]$Production = 'true'
)

$ErrorActionPreference = "Stop"
$CertDir = Resolve-Path $CertDir

$keyFile = Join-Path $CertDir "privada.key"
$crtFile = Join-Path $CertDir "certificado.crt"
$cuitFile = Join-Path $CertDir "afip-cuit.txt"

if (-not (Test-Path $keyFile)) { throw "Falta privada.key en $CertDir" }
if (-not (Test-Path $crtFile)) { throw "Falta certificado.crt en $CertDir" }

$openssl = "C:\Program Files\Git\usr\bin\openssl.exe"
if (Test-Path $openssl) {
  $cm = & $openssl x509 -noout -modulus -in $crtFile 2>$null
  $km = & $openssl rsa -noout -modulus -in $keyFile 2>$null
  if ($cm -ne $km) { throw "certificado.crt y privada.key NO coinciden" }
  Write-Host "OK: certificado y clave privada coinciden." -ForegroundColor Green
}

if (Test-Path $cuitFile) {
  $cuit = (Get-Content $cuitFile -Raw).Trim()
} else {
  $subj = & $openssl x509 -in $crtFile -noout -subject 2>$null
  if ($subj -match 'CUIT\s*(\d{11})') { $cuit = $Matches[1] }
  else { throw "Crear $cuitFile con el CUIT de 11 digitos (ej. 20217563519)" }
}
if ($cuit -notmatch '^\d{11}$') { throw "CUIT invalido en afip-cuit.txt" }
Set-Content -Path $cuitFile -Value $cuit -NoNewline -Encoding ASCII

Write-Host "Subiendo secrets (proyecto Firebase actual)..." -ForegroundColor Cyan
firebase functions:secrets:set AFIP_CUIT --data-file $cuitFile --force
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
firebase functions:secrets:set AFIP_CERT --data-file $crtFile --force
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
firebase functions:secrets:set AFIP_PRIVATE_KEY --data-file $keyFile --force
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$prodFile = Join-Path $env:TEMP "afip-production-$Production.txt"
Set-Content -Path $prodFile -Value $Production -NoNewline -Encoding ASCII
firebase functions:secrets:set AFIP_PRODUCTION --data-file $prodFile --force
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Remove-Item -Force $prodFile -ErrorAction SilentlyContinue

Write-Host "Secrets AFIP actualizados (AFIP_PRODUCTION=$Production)." -ForegroundColor Green

if ($SkipDeploy) { exit 0 }

$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot
firebase deploy --only functions:lookupClientByCuit --force
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { exit $code }
Write-Host "Deploy lookupClientByCuit OK (AFIP_PRODUCTION=$Production)." -ForegroundColor Green
