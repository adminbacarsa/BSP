# start-emulator.ps1
# Uso: powershell -ExecutionPolicy Bypass -File .\scripts\start-emulator.ps1 [ruta-al-backup.json]

param(
  [string]$BackupFile = ""
)

$root = Split-Path $PSScriptRoot -Parent

Write-Host ""
Write-Host "COSP V1.0 - Modo Local (Emulador Firebase)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Preparar .env.local con modo emulador
Write-Host "Activando modo emulador en apps/web2/.env.local..." -ForegroundColor Yellow
Copy-Item "$root\apps\web2\.env.emulator" "$root\apps\web2\.env.local" -Force
Write-Host "  OK" -ForegroundColor Green

# 2. Abrir emuladores en ventana separada (sin --import, el seed lo hace despues)
Write-Host ""
Write-Host "Abriendo Firebase Emulators en ventana separada..." -ForegroundColor Yellow
Write-Host "  UI:        http://localhost:4000" -ForegroundColor Gray
Write-Host "  Firestore: localhost:8080" -ForegroundColor Gray
Write-Host "  Auth:      localhost:9099" -ForegroundColor Gray
Write-Host ""

Start-Process cmd -ArgumentList "/k", "cd /d `"$root`" && firebase emulators:start --only auth,firestore"

# Esperar a que los emuladores inicien
Write-Host "Esperando que los emuladores inicien (20s)..." -ForegroundColor DarkGray
Start-Sleep -Seconds 20

# 3. Sembrar datos si hay backup
if ($BackupFile -ne "" -and (Test-Path $BackupFile)) {
  Write-Host ""
  Write-Host "Sembrando datos desde backup..." -ForegroundColor Yellow
  node "$root\scripts\seed-emulator.js" $BackupFile
} else {
  Write-Host "Sin backup - Firestore arranca vacio." -ForegroundColor DarkYellow
  Write-Host "Podes sembrar despues con: node scripts/seed-emulator.js <backup.json>" -ForegroundColor DarkGray
}

# 4. Levantar Next.js
Write-Host ""
Write-Host "Iniciando Next.js en http://localhost:3000" -ForegroundColor Cyan
Write-Host "Ctrl+C para detener Next.js" -ForegroundColor DarkGray
Write-Host ""

Set-Location "$root\apps\web2"
cmd /c "npm run dev"
