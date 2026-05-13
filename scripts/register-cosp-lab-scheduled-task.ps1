# Registra tarea "COSP Lab" (emuladores + seed + Next). PowerShell como administrador.
#
#   .\register-cosp-lab-scheduled-task.ps1
#       Al iniciar sesión del usuario actual.
#   .\register-cosp-lab-scheduled-task.ps1 -AtStartupAsSystem
#       Al arrancar Windows como SYSTEM (3 min demora). Sin login. Node en Program Files.

param([switch]$AtStartupAsSystem)

$ErrorActionPreference = 'Stop'
$taskName = 'COSP Lab'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Ejecutá como Administrador.' -ForegroundColor Red
  exit 1
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $PSScriptRoot 'start-lab-scheduled.ps1'
if (-not (Test-Path -LiteralPath $launcher)) {
  Write-Host "No existe: $launcher" -ForegroundColor Red
  exit 1
}

$pwsh = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$action = New-ScheduledTaskAction -Execute $pwsh -Argument $arg -WorkingDirectory $projectRoot

if ($AtStartupAsSystem) {
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $trigger.Delay = 'PT3M'
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $modeDesc = 'Arranque sistema (SYSTEM, demora 3 min)'
} else {
  $userId = "$env:USERDOMAIN\$env:USERNAME"
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
  $modeDesc = "Inicio de sesión ($userId)"
}

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "COSP lab: emuladores+seed+Next. $modeDesc Repo: $projectRoot" `
  | Out-Null

Write-Host "Tarea: $taskName" -ForegroundColor Green
Write-Host "Modo: $modeDesc" -ForegroundColor Cyan
Write-Host 'Trazas: %ProgramData%\COSP\trace.log' -ForegroundColor Cyan
Write-Host 'Logs repo: logs\lab-boot.log, emulators-task.log, seed-lab.log, next-dev-task.log' -ForegroundColor Cyan
Write-Host 'Probar: schtasks /Run /TN "COSP Lab"' -ForegroundColor DarkGray
