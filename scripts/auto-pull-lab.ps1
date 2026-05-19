# Comprueba origin/main; si hay commits nuevos: pull + reinicio lab (emuladores, seed, Next).
# Pensado para tarea programada cada 5 min. Logs: logs\auto-pull.log y %ProgramData%\COSP\trace.log
param(
  [switch]$Force,
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'

function Write-Trace([string]$msg) {
  try {
    $dir = Join-Path $env:ProgramData 'COSP'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    "$(Get-Date -Format o) [auto-pull] $msg" | Add-Content -LiteralPath (Join-Path $dir 'trace.log')
  } catch {}
}

try {
  $projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
} catch {
  Write-Trace "ERROR Resolve-Path: $_"
  exit 1
}

$logsDir = Join-Path $projectRoot 'logs'
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }
$logFile = Join-Path $logsDir 'auto-pull.log'
$lockFile = Join-Path $logsDir 'auto-pull.lock'

function Log([string]$line) {
  $row = "$(Get-Date -Format o) $line"
  $row | Add-Content -LiteralPath $logFile
  Write-Trace $line
}

function Find-NpmCmd {
  $c = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($c -and $c.Source -and (Test-Path -LiteralPath $c.Source)) { return $c.Source }
  foreach ($p in @("${env:ProgramFiles}\nodejs\npm.cmd", "${env:ProgramFiles(x86)}\nodejs\npm.cmd")) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}

function Test-TcpPort([int]$Port, [string]$HostName = '127.0.0.1') {
  $client = $null
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($HostName, $Port, $null, $null)
    if ($iar.AsyncWaitHandle.WaitOne(1500, $false)) {
      try { $client.EndConnect($iar) } catch {}
      return $true
    }
  } catch {
  } finally {
    if ($null -ne $client) { try { $client.Close() } catch {} }
  }
  return $false
}

function Wait-TcpPorts([int[]]$Ports, [int]$TimeoutSec = 180) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $all = $true
    foreach ($port in $Ports) {
      if (-not (Test-TcpPort $port)) { $all = $false; break }
    }
    if ($all) { return $true }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Stop-LabPorts {
  foreach ($port in @(3000, 4000, 4400, 5001, 8080, 9099)) {
    try {
      Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    } catch {
      netstat -ano | findstr "LISTENING" | findstr ":$port " | ForEach-Object {
        $pid = ($_ -split '\s+')[-1]
        if ($pid -match '^\d+$') { taskkill /F /PID $pid 2>$null | Out-Null }
      }
    }
  }
  Start-Sleep -Seconds 2
}

if (Test-Path -LiteralPath $lockFile) {
  $age = (Get-Date) - (Get-Item -LiteralPath $lockFile).LastWriteTime
  if ($age.TotalMinutes -lt 25) {
    Log 'SKIP: otra ejecución en curso (lock activo)'
    exit 0
  }
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}

Set-Content -LiteralPath $lockFile -Value "$PID $(Get-Date -Format o)" -Encoding ASCII

try {
  Set-Location $projectRoot

  $npm = Find-NpmCmd
  if (-not $npm) {
    Log 'ERROR: npm.cmd no encontrado'
    exit 1
  }
  $nodeDir = Split-Path -Parent $npm
  $nodeExe = Join-Path $nodeDir 'node.exe'
  $prefix = $nodeDir
  if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin'))) {
    $prefix = "$(Join-Path $env:JAVA_HOME 'bin');$prefix"
  }
  $newPath = "$prefix;$env:PATH"

  Log "CHECK branch=$Branch user=$env:USERNAME"

  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  git fetch origin $Branch 2>&1 | Out-Null
  $fetchExit = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($fetchExit -ne 0) {
    Log 'ERROR: git fetch falló (red o credenciales)'
    exit 1
  }

  $local = (git rev-parse HEAD 2>$null).Trim()
  $remote = (git rev-parse "origin/$Branch" 2>$null).Trim()
  if (-not $remote) {
    Log "ERROR: no existe origin/$Branch"
    exit 1
  }

  if ($local -eq $remote -and -not $Force) {
    Log "OK: sin cambios ($($local.Substring(0,7)))"
    exit 0
  }

  $msg = git log -1 --oneline "origin/$Branch"
  Log "PULL: $local -> $remote ($msg)"

  git reset --hard "origin/$Branch"
  if ($LASTEXITCODE -ne 0) {
    Log 'ERROR: git reset --hard falló'
    exit 1
  }

  Log 'npm install...'
  & $npm install 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Log 'ERROR: npm install falló'
    exit 1
  }

  $nextCache = Join-Path $projectRoot 'apps\web2\.next'
  if (Test-Path -LiteralPath $nextCache) {
    Remove-Item -Recurse -Force -LiteralPath $nextCache -ErrorAction SilentlyContinue
    Log '.next borrado'
  }

  Log 'Reiniciando puertos lab...'
  Stop-LabPorts

  $logEmul = Join-Path $logsDir 'emulators-auto-pull.log'
  $logSeed = Join-Path $logsDir 'seed-auto-pull.log'
  $logDev = Join-Path $logsDir 'next-auto-pull.log'

  $emulBatch = "set `"PATH=$newPath`" && cd /d `"$projectRoot`" && `"$npm`" run emulators >> `"$logEmul`" 2>&1"
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $emulBatch) -WorkingDirectory $projectRoot -WindowStyle Hidden
  Log 'Emuladores lanzados'

  if (-not (Wait-TcpPorts @(8080, 9099, 5001) 240)) {
    Log 'ERROR: timeout emuladores (8080/9099/5001) — ver emulators-auto-pull.log'
    exit 1
  }
  Log 'Emuladores listos'

  $seedBatch = "set `"PATH=$newPath`" && cd /d `"$projectRoot`" && `"$nodeExe`" scripts\seed-lab.js >> `"$logSeed`" 2>&1"
  $seedProc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $seedBatch) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -Wait
  Log "Seed exit=$($seedProc.ExitCode)"

  $devBatch = "set `"PATH=$newPath`" && cd /d `"$projectRoot`" && `"$npm`" --prefix apps/web2 run dev -- -H 0.0.0.0 >> `"$logDev`" 2>&1"
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $devBatch) -WorkingDirectory $projectRoot -WindowStyle Hidden
  Log 'Next dev lanzado'

  if (Wait-TcpPorts @(3000) 90) {
    Log 'Lab actualizado — http://192.168.0.8:3000'
  } else {
    Log 'AVISO: Next aún iniciando en :3000'
  }

  exit 0
} catch {
  Log "ERROR: $($_.Exception.Message)"
  exit 1
} finally {
  if (Test-Path -LiteralPath $lockFile) {
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
  }
}
