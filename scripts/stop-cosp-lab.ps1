# Detiene emuladores Firebase + puente backup (no mata Next :3001 salvo -All).
# Uso: npm run stop:lab
#      npm run stop:lab -- -All   (incluye Next dev)
param([switch]$All)

$ErrorActionPreference = 'Continue'
$ports = @(8080, 9099, 5001, 4000, 4400, 3010)
if ($All) { $ports += @(3001, 3000) }

Write-Host 'COSP Lab — deteniendo procesos en puertos:' ($ports -join ', ') -ForegroundColor Yellow

foreach ($port in $ports) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    $owningPid = $c.OwningProcess
    if (-not $owningPid) { continue }
    $proc = Get-Process -Id $owningPid -ErrorAction SilentlyContinue
    if ($proc) {
      Write-Host "  :$port -> PID $owningPid ($($proc.ProcessName))" -ForegroundColor DarkGray
      Stop-Process -Id $owningPid -Force -ErrorAction SilentlyContinue
    }
  }
}

Start-Sleep -Seconds 2

$still = @()
foreach ($port in $ports) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    $still += $port
  }
}

if ($still.Count -gt 0) {
  Write-Host "AVISO: puertos aún en uso: $($still -join ', ')" -ForegroundColor Red
  exit 1
}

Write-Host 'Lab detenido. Arrancar de nuevo: npm run lab  o  npm run emulators' -ForegroundColor Green
