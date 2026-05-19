# Tarea programada: cada 5 min comprueba origin/main y hace pull + reinicio lab si hay commits nuevos.
# PowerShell como administrador:
#   npm run register:auto-pull-task
#   npm run register:auto-pull-task:system   (al arrancar Windows, cuenta SYSTEM)

param([switch]$AtStartupAsSystem)

$ErrorActionPreference = 'Stop'
$taskName = 'COSP Auto Pull'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Ejecutá como Administrador.' -ForegroundColor Red
  exit 1
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $PSScriptRoot 'auto-pull-lab.ps1'
if (-not (Test-Path -LiteralPath $launcher)) {
  Write-Host "No existe: $launcher" -ForegroundColor Red
  exit 1
}

$pwsh = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$action = New-ScheduledTaskAction -Execute $pwsh -Argument $arg -WorkingDirectory $projectRoot

$repeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)

if ($AtStartupAsSystem) {
  $bootTrigger = New-ScheduledTaskTrigger -AtStartup
  $bootTrigger.Delay = 'PT2M'
  $trigger = @($bootTrigger, $repeatTrigger)
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $modeDesc = 'Arranque sistema (SYSTEM) + cada 5 min'
} else {
  $userId = "$env:USERDOMAIN\$env:USERNAME"
  $trigger = $repeatTrigger
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
  $modeDesc = "Usuario $userId + cada 5 min"
}

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -MultipleInstances IgnoreNew

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "COSP N8N: git fetch; si origin/main avanzó → pull + reinicio lab. Repo: $projectRoot" `
  | Out-Null

Write-Host "Tarea: $taskName" -ForegroundColor Green
Write-Host "Modo: $modeDesc" -ForegroundColor Cyan
Write-Host 'Logs: logs\auto-pull.log' -ForegroundColor Cyan
Write-Host 'Probar ahora: schtasks /Run /TN "COSP Auto Pull"' -ForegroundColor DarkGray
Write-Host 'Quitar: npm run unregister:auto-pull-task' -ForegroundColor DarkGray
