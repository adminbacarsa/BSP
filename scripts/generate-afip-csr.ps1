# Genera clave privada (2048 bits) y CSR PKCS#10 para AFIP / ARCA.
# Manual: https://www.afip.gob.ar/ws/WSASS/html/generarcsr.html
#
# Uso:
#   npm run afip:csr
#   powershell -ExecutionPolicy Bypass -File scripts\generate-afip-csr.ps1 -Cuit 30701234567 -Empresa "BACAR SA" -Alias "cosp-prod"

param(
  [string]$Cuit = "",
  [string]$Empresa = "",
  [string]$Alias = "cosp-cronoapp",
  [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

function Find-OpenSsl {
  $cmd = Get-Command openssl -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "C:\Program Files\Git\usr\bin\openssl.exe",
    "C:\Program Files\OpenSSL-Win64\bin\openssl.exe",
    "C:\Program Files (x86)\OpenSSL-Win32\bin\openssl.exe"
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Read-Required([string]$Prompt, [string]$Default = "") {
  if ($Default) {
    $v = Read-Host "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($v)) { return $Default }
    return $v.Trim()
  }
  do {
    $v = Read-Host $Prompt
    $v = $v.Trim()
  } while ([string]::IsNullOrWhiteSpace($v))
  return $v
}

$openssl = Find-OpenSsl
if (-not $openssl) {
  Write-Host ""
  Write-Host "No se encontro OpenSSL." -ForegroundColor Red
  Write-Host "Instala Git for Windows o Win64 OpenSSL y vuelve a ejecutar." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "=== CSR AFIP (PKCS#10) - COSP ===" -ForegroundColor Cyan
Write-Host "OpenSSL: $openssl" -ForegroundColor DarkGray

if ([string]::IsNullOrWhiteSpace($Cuit)) {
  $Cuit = Read-Required "CUIT de la empresa (11 digitos, sin guiones)"
}
$cuitDigits = ($Cuit -replace '\D', '')
if ($cuitDigits.Length -ne 11) {
  Write-Host "CUIT invalido: deben ser 11 digitos." -ForegroundColor Red
  exit 1
}

if ([string]::IsNullOrWhiteSpace($Empresa)) {
  $Empresa = Read-Required "Razon social (campo O)" "BACAR SA"
}

if ([string]::IsNullOrWhiteSpace($Alias)) {
  $Alias = Read-Required "Alias del sistema (campo CN, igual en AFIP)" "cosp-cronoapp"
}
$Alias = $Alias -replace '[^\w\-.]', ''

if ([string]::IsNullOrWhiteSpace($OutDir)) {
  $repoRoot = Split-Path $PSScriptRoot -Parent
  $OutDir = Join-Path (Join-Path $repoRoot "scripts") "afip-csr-$cuitDigits"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$keyFile = Join-Path $OutDir "privada.key"
$csrFile = Join-Path $OutDir "pedido.csr"
$cnfFile = Join-Path $OutDir "openssl-afip.cnf"
$csrTxt  = Join-Path $OutDir "pedido-para-pegar-en-afip.txt"

$template = Join-Path $PSScriptRoot "afip-csr-openssl.cnf.template"
if (-not (Test-Path $template)) {
  Write-Host "Falta plantilla: $template" -ForegroundColor Red
  exit 1
}

$cnfContent = Get-Content $template -Raw -Encoding UTF8
$cnfContent = $cnfContent -replace '\{\{CUIT\}\}', $cuitDigits
$cnfContent = $cnfContent -replace '\{\{O\}\}', $Empresa
$cnfContent = $cnfContent -replace '\{\{CN\}\}', $Alias
Set-Content -Path $cnfFile -Value $cnfContent -Encoding UTF8 -NoNewline

Write-Host ""
Write-Host "Generando clave privada (2048 bits)..." -ForegroundColor Yellow
& $openssl genrsa -out $keyFile 2048
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Generando CSR (serialNumber = CUIT $cuitDigits)..." -ForegroundColor Yellow
& $openssl req -new -key $keyFile -config $cnfFile -out $csrFile -outform PEM
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$csrPem = Get-Content $csrFile -Raw -Encoding ASCII
Set-Content -Path $csrTxt -Value $csrPem.Trim() -Encoding ASCII

Write-Host ""
Write-Host "Listo. Carpeta:" -ForegroundColor Green
Write-Host "  $OutDir" -ForegroundColor White
Write-Host ""
Write-Host "  privada.key  - NO commitear; guardar seguro" -ForegroundColor Yellow
Write-Host "  pedido.csr / pedido-para-pegar-en-afip.txt" -ForegroundColor Gray
Write-Host ""

Write-Host "---------- CONTENIDO CSR (copiar en AFIP) ----------" -ForegroundColor Cyan
Write-Host $csrPem.Trim()
Write-Host "---------- FIN CSR ----------" -ForegroundColor Cyan
Write-Host ""

try {
  Set-Clipboard -Value $csrPem.Trim()
  Write-Host "CSR copiado al portapapeles." -ForegroundColor Green
} catch {
  Write-Host "Abri pedido-para-pegar-en-afip.txt y copia manualmente." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "En AFIP / ARCA:" -ForegroundColor Cyan
Write-Host "  1. Administracion de Certificados Digitales" -ForegroundColor Gray
Write-Host "  2. Agregar alias - Alias = $Alias (igual al CN del CSR)" -ForegroundColor Gray
Write-Host "  3. Pegar el CSR completo (BEGIN CERTIFICATE REQUEST ... END)" -ForegroundColor Gray
Write-Host "  4. Descargar el .crt; luego AFIP_CERT y AFIP_PRIVATE_KEY en Secret Manager" -ForegroundColor Gray
Write-Host ""
