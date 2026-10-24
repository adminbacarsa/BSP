# Registra la tarea "COSP Servidor N8N" (N8N + PM2 + Caddy) al iniciar sesion de un usuario
# y, opcionalmente, el inicio de sesion automatico de ese usuario. PowerShell como Administrador.
#
#   .\register-n8n-server-startup.ps1
#       Solo la tarea al iniciar sesion de Soporte.
#   .\register-n8n-server-startup.ps1 -AutoLogon
#       Tarea + inicio de sesion automatico de Soporte (pide la contrasena).
#   .\register-n8n-server-startup.ps1 -DisableAutoLogon
#       Quita el inicio de sesion automatico (la tarea queda).
#   .\register-n8n-server-startup.ps1 -Unregister
#       Quita la tarea.
param(
  [string]$UserName = 'Soporte',
  [switch]$AutoLogon,
  [switch]$DisableAutoLogon,
  [switch]$Unregister
)

$ErrorActionPreference = 'Stop'
$taskName = 'COSP Servidor N8N'
$winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Ejecuta como Administrador.' -ForegroundColor Red
  exit 1
}

if ($Unregister) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tarea quitada: $taskName" -ForegroundColor Yellow
  exit 0
}

if ($DisableAutoLogon) {
  Set-ItemProperty -Path $winlogon -Name 'AutoAdminLogon' -Value '0'
  Remove-ItemProperty -Path $winlogon -Name 'DefaultPassword' -ErrorAction SilentlyContinue
  Write-Host 'Inicio de sesion automatico desactivado.' -ForegroundColor Yellow
  exit 0
}

$domain = $env:COMPUTERNAME
$localUser = Get-LocalUser -Name $UserName -ErrorAction SilentlyContinue
if (-not $localUser) {
  Write-Host "No existe el usuario local '$UserName' en $domain." -ForegroundColor Red
  exit 1
}
$userId = "$domain\$UserName"

$launcher = Join-Path $PSScriptRoot 'start-n8n-server.ps1'
if (-not (Test-Path -LiteralPath $launcher)) {
  Write-Host "No existe: $launcher" -ForegroundColor Red
  exit 1
}
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$pwsh = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$action = New-ScheduledTaskAction -Execute $pwsh -Argument $arg -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
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
  -Description "N8N (NSSM) + pm2 resurrect + Caddy al iniciar sesion de $userId. Repo: $projectRoot" `
  | Out-Null

Write-Host "Tarea: $taskName (al iniciar sesion de $userId)" -ForegroundColor Green

if ($AutoLogon) {
  $secure = Read-Host "Contrasena de $userId (inicio de sesion automatico)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  if ([string]::IsNullOrEmpty($plain)) {
    Write-Host 'Contrasena vacia: no se configura el inicio automatico.' -ForegroundColor Red
    exit 1
  }

  # Autologon de Sysinternals guarda la contrasena cifrada (LSA). Si no esta, se usa el registro.
  $autologonExe = @(
    'D:\APP\autologon\Autologon64.exe',
    'D:\APP\autologon\Autologon.exe',
    (Join-Path $PSScriptRoot 'Autologon64.exe')
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

  if ($autologonExe) {
    & $autologonExe $UserName $domain $plain /accepteula
    Write-Host "Inicio de sesion automatico configurado con $autologonExe (contrasena cifrada)." -ForegroundColor Green
  } else {
    Set-ItemProperty -Path $winlogon -Name 'AutoAdminLogon' -Value '1'
    Set-ItemProperty -Path $winlogon -Name 'DefaultUserName' -Value $UserName
    Set-ItemProperty -Path $winlogon -Name 'DefaultDomainName' -Value $domain
    Set-ItemProperty -Path $winlogon -Name 'DefaultPassword' -Value $plain
    Remove-ItemProperty -Path $winlogon -Name 'AutoLogonCount' -ErrorAction SilentlyContinue
    Write-Host 'Inicio de sesion automatico configurado en el registro (Winlogon).' -ForegroundColor Green
    Write-Host 'AVISO: la contrasena queda en texto plano en el registro. Para cifrarla, baja Autologon de Sysinternals a D:\APP\autologon y volve a ejecutar con -AutoLogon.' -ForegroundColor Yellow
  }
  $plain = $null

  $pwdLess = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device'
  if (Test-Path $pwdLess) {
    Set-ItemProperty -Path $pwdLess -Name 'DevicePasswordLessBuildVersion' -Value 0 -Type DWord
  }
}

Write-Host "Log del arranque: $env:ProgramData\COSP\n8n-server-startup.log" -ForegroundColor Cyan
Write-Host "Probar sin reiniciar: schtasks /Run /TN `"$taskName`"" -ForegroundColor DarkGray
