# Diagnóstico arranque lab (sin admin). Ejecutar desde la raíz del repo: npm run diagnose:lab
$ErrorActionPreference = 'Continue'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Write-Host "Repo: $projectRoot" -ForegroundColor Cyan

$trace = Join-Path $env:ProgramData 'COSP\trace.log'
Write-Host "`n--- $trace ---" -ForegroundColor DarkGray
if (Test-Path $trace) { Get-Content $trace -Tail 25 } else { Write-Host '(no existe aún)' }

$task = Get-ScheduledTask -TaskName 'COSP Lab' -ErrorAction SilentlyContinue
if ($task) {
  Write-Host "`nTarea COSP Lab: $($task.State)" -ForegroundColor Green
  Write-Host "  Usuario/principal: $($task.Principal.UserId)  Logon: $($task.Principal.LogonType)" -ForegroundColor DarkGray
  Get-ScheduledTaskInfo -TaskName 'COSP Lab' -ErrorAction SilentlyContinue | Format-List LastRunTime, LastTaskResult, NextRunTime
} else {
  Write-Host "`nTarea COSP Lab: NO registrada" -ForegroundColor Yellow
  Write-Host '  Registrá (admin): powershell -ExecutionPolicy Bypass -File scripts\register-cosp-lab-scheduled-task.ps1' -ForegroundColor Yellow
  Write-Host '  Sin login (admin): ...\register-cosp-lab-scheduled-task.ps1 -AtStartupAsSystem' -ForegroundColor Yellow
}

$logs = @('lab-boot.log', 'emulators-task.log', 'seed-lab.log', 'next-dev-task.log')
foreach ($n in $logs) {
  $f = Join-Path $projectRoot "logs\$n"
  Write-Host "`n--- $n ---" -ForegroundColor DarkGray
  if (Test-Path $f) { Get-Content $f -Tail 12 } else { Write-Host '(no existe)' }
}

Write-Host "`nPuertos:" -ForegroundColor Cyan
netstat -an | Select-String ':3000|:4000|:8080|:9099' | Select-Object -First 15
