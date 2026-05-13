# Quita la tarea "COSP Lab". PowerShell como administrador.
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Ejecutá como Administrador.' -ForegroundColor Red
  exit 1
}
Unregister-ScheduledTask -TaskName 'COSP Lab' -Confirm:$false -ErrorAction SilentlyContinue
Write-Host 'Tarea COSP Lab eliminada.' -ForegroundColor Green
