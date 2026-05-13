# Arranque automático: emuladores → espera 8080 → seed (admin+guardia) → Next dev.
# Trazas en %ProgramData%\COSP\trace.log (aunque falle el repo) y logs\ en el repo.
$ErrorActionPreference = 'Stop'

function Write-Trace([string]$msg) {
  try {
    $dir = Join-Path $env:ProgramData 'COSP'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    "$(Get-Date -Format o) $msg" | Add-Content -LiteralPath (Join-Path $dir 'trace.log')
  } catch {}
}

try {
  $projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
} catch {
  Write-Trace "ERROR Resolve-Path scriptRoot: $_"
  exit 1
}

Write-Trace "START user=$env:USERNAME computer=$env:COMPUTERNAME repo=$projectRoot"

$logsDir = Join-Path $projectRoot 'logs'
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }

$bootLog = Join-Path $logsDir 'lab-boot.log'
$logEmul = Join-Path $logsDir 'emulators-task.log'
$logSeed = Join-Path $logsDir 'seed-lab.log'
$logDev = Join-Path $logsDir 'next-dev-task.log'

function Append-Boot([string]$line) {
  "$(Get-Date -Format o) $line" | Add-Content -LiteralPath $bootLog
  Write-Trace $line
}

function Find-NpmCmd {
  $c = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($c -and $c.Source -and (Test-Path -LiteralPath $c.Source)) { return $c.Source }
  foreach ($p in @(
      "${env:ProgramFiles}\nodejs\npm.cmd",
      "${env:ProgramFiles(x86)}\nodejs\npm.cmd"
    )) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}

function Wait-FirestoreEmulator([int]$TimeoutSec = 180) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $c = $null
    try {
      $c = New-Object System.Net.Sockets.TcpClient
      $iar = $c.BeginConnect('127.0.0.1', 8080, $null, $null)
      if ($iar.AsyncWaitHandle.WaitOne(2000, $false)) {
        try { $c.EndConnect($iar) } catch {}
        return $true
      }
    } catch {
    } finally {
      if ($null -ne $c) { try { $c.Close() } catch {} }
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

Append-Boot "Inicio lab"

$npm = Find-NpmCmd
if (-not $npm) {
  Append-Boot 'ERROR: npm.cmd no encontrado. Instalá Node en Program Files\nodejs.'
  exit 1
}
$nodeDir = Split-Path -Parent $npm
$nodeExe = Join-Path $nodeDir 'node.exe'
Append-Boot "npm=$npm"

$prefix = $nodeDir
if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin'))) {
  $prefix = "$(Join-Path $env:JAVA_HOME 'bin');$prefix"
}
$newPath = "$prefix;$env:PATH"

function Start-LabCmd([string]$label, [string]$innerCmd) {
  $batch = "set `"PATH=$newPath`" && cd /d `"$projectRoot`" && $innerCmd"
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $batch) -WorkingDirectory $projectRoot -WindowStyle Hidden
  Append-Boot "Lanzado: $label"
}

Start-LabCmd 'emulators' "`"$npm`" run emulators >> `"$logEmul`" 2>&1"

Append-Boot 'Esperando 127.0.0.1:8080...'
if (-not (Wait-FirestoreEmulator 180)) {
  Append-Boot 'ERROR: timeout 8080; revisar emulators-task.log y JDK/firebase-tools'
} else {
  $seedBatch = "set `"PATH=$newPath`" && cd /d `"$projectRoot`" && `"$nodeExe`" scripts\seed-lab.js >> `"$logSeed`" 2>&1"
  $seedProc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $seedBatch) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -Wait
  Append-Boot "Seed exit=$($seedProc.ExitCode)"
}

Start-Sleep -Seconds 15

Start-LabCmd 'next dev' "`"$npm`" run dev >> `"$logDev`" 2>&1"

Append-Boot 'Fin arranque lab'
Write-Trace 'END ok'
