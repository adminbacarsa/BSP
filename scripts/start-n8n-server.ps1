# Arranque PC N8N: servicio n8n (NSSM) -> espera :5678 -> pm2 resurrect -> Caddy (HTTPS).
# Lo dispara la tarea "COSP Servidor N8N" al iniciar sesion de Soporte.
# Log: %ProgramData%\COSP\n8n-server-startup.log
param(
  [string]$NssmExe = 'D:\APP\nssm\nssm.exe',
  [string]$N8nService = 'n8n',
  [int]$N8nPort = 5678,
  [string]$CaddyDir = 'D:\APP\caddy',
  [string]$CaddyService = 'caddy',
  [int]$BootDelaySec = 20
)

$ErrorActionPreference = 'Continue'

$logDir = Join-Path $env:ProgramData 'COSP'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir 'n8n-server-startup.log'

function Write-Log([string]$msg) {
  $line = "$(Get-Date -Format o) $msg"
  try { $line | Add-Content -LiteralPath $logFile } catch {}
  Write-Host $line
}

function Test-Port([int]$Port) {
  $c = $null
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
    if ($iar.AsyncWaitHandle.WaitOne(2000, $false)) {
      try { $c.EndConnect($iar) } catch { return $false }
      return $true
    }
    return $false
  } catch {
    return $false
  } finally {
    if ($null -ne $c) { try { $c.Close() } catch {} }
  }
}

function Wait-Port([int]$Port, [int]$TimeoutSec) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $Port) { return $true }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Find-Pm2 {
  $c = Get-Command pm2.cmd -ErrorAction SilentlyContinue
  if ($c -and $c.Source) { return $c.Source }
  $c = Get-Command pm2 -ErrorAction SilentlyContinue
  if ($c -and $c.Source) { return $c.Source }
  $candidate = Join-Path $env:APPDATA 'npm\pm2.cmd'
  if (Test-Path -LiteralPath $candidate) { return $candidate }
  return $null
}

function Get-ServiceSafe([string]$Name) {
  return Get-Service -Name $Name -ErrorAction SilentlyContinue
}

function Start-WindowsService([string]$Name) {
  $svc = Get-ServiceSafe $Name
  if (-not $svc) { return $false }
  if ($svc.Status -eq 'Running') {
    Write-Log "Servicio $Name ya estaba corriendo"
    return $true
  }
  try {
    Start-Service -Name $Name -ErrorAction Stop
    Write-Log "Servicio $Name iniciado (Start-Service)"
    return $true
  } catch {
    if (Test-Path -LiteralPath $NssmExe) {
      & $NssmExe start $Name 2>&1 | ForEach-Object { Write-Log "nssm: $_" }
      $svc = Get-ServiceSafe $Name
      if ($svc -and $svc.Status -eq 'Running') { return $true }
    }
    Write-Log "ERROR no se pudo iniciar el servicio ${Name}: $_"
    return $false
  }
}

Write-Log "START user=$env:USERNAME computer=$env:COMPUTERNAME"

if ($BootDelaySec -gt 0) {
  Write-Log "Esperando $BootDelaySec s a que termine de levantar la red..."
  Start-Sleep -Seconds $BootDelaySec
}

# 1) N8N
if (Get-ServiceSafe $N8nService) {
  [void](Start-WindowsService $N8nService)
} else {
  Write-Log "AVISO: no existe el servicio '$N8nService' (NSSM). N8N no se inicia desde aca."
}

Write-Log "Esperando 127.0.0.1:$N8nPort (N8N)..."
if (Wait-Port $N8nPort 180) {
  Write-Log "N8N responde en :$N8nPort"
} else {
  Write-Log "AVISO: N8N no respondio en :$N8nPort en 180 s; sigo con PM2 y Caddy"
}

# 2) PM2
$pm2 = Find-Pm2
if (-not $pm2) {
  Write-Log 'AVISO: pm2 no encontrado (npm install -g pm2). Se omite PM2.'
} else {
  Write-Log "pm2=$pm2"
  $dump = Join-Path $env:USERPROFILE '.pm2\dump.pm2'
  if (Test-Path -LiteralPath $dump) {
    & $pm2 resurrect 2>&1 | ForEach-Object { Write-Log "pm2: $_" }
  } else {
    Write-Log "AVISO: no hay $dump. Arranca tus procesos una vez y ejecuta 'pm2 save'."
  }
  & $pm2 list 2>&1 | ForEach-Object { Write-Log "pm2: $_" }
}

# 3) Caddy
if (Get-ServiceSafe $CaddyService) {
  [void](Start-WindowsService $CaddyService)
} else {
  $caddyExe = Join-Path $CaddyDir 'caddy.exe'
  $caddyFile = Join-Path $CaddyDir 'Caddyfile'
  $repoCaddyfile = Join-Path (Split-Path -Parent $PSScriptRoot) 'Caddyfile.n8n'
  if ((Test-Path -LiteralPath $repoCaddyfile) -and (Test-Path -LiteralPath $CaddyDir)) {
    Copy-Item -LiteralPath $repoCaddyfile -Destination $caddyFile -Force
  }
  if (Get-Process -Name caddy -ErrorAction SilentlyContinue) {
    Write-Log 'Caddy ya estaba corriendo'
  } elseif (-not (Test-Path -LiteralPath $caddyExe)) {
    Write-Log "ERROR: no existe $caddyExe"
  } elseif (-not (Test-Path -LiteralPath $caddyFile)) {
    Write-Log "ERROR: no existe $caddyFile"
  } else {
    $caddyLog = Join-Path $logDir 'caddy.log'
    Start-Process -FilePath $caddyExe `
      -ArgumentList @('run', '--config', "`"$caddyFile`"") `
      -WorkingDirectory $CaddyDir `
      -WindowStyle Hidden `
      -RedirectStandardError $caddyLog
    Start-Sleep -Seconds 5
    if (Get-Process -Name caddy -ErrorAction SilentlyContinue) {
      Write-Log "Caddy iniciado (log: $caddyLog)"
    } else {
      Write-Log "ERROR: Caddy no quedo corriendo; revisar $caddyLog"
    }
  }
}

Write-Log 'END'
