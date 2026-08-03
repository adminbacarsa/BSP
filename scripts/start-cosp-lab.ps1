# COSP Lab — una ventana: emuladores + seed + Next dev (+ Cursor opcional).
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\start-cosp-lab.ps1
#   npm run lab
# Doble clic: INICIAR-LAB-COSP.cmd (raíz del repo)
param(
  [switch]$NoSeed,
  [switch]$NoCursor,
  [switch]$NoBrowser,
  [switch]$Restart,
  [switch]$Network,
  [switch]$WithExpo
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$devPort = if ($env:COSP_DEV_PORT) { [int]$env:COSP_DEV_PORT } else { 3001 }

function Write-Step([string]$msg, [string]$color = 'Cyan') {
  Write-Host $msg -ForegroundColor $color
}

function Find-NpmCmd {
  $c = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($c -and $c.Source -and (Test-Path -LiteralPath $c.Source)) { return $c.Source }
  foreach ($p in @("${env:ProgramFiles}\nodejs\npm.cmd", "${env:ProgramFiles(x86)}\nodejs\npm.cmd")) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}

function Find-CursorExe {
  $c = Get-Command cursor -ErrorAction SilentlyContinue
  if ($c -and $c.Source -and (Test-Path -LiteralPath $c.Source)) { return $c.Source }
  $local = Join-Path $env:LOCALAPPDATA 'Programs\cursor\Cursor.exe'
  if (Test-Path -LiteralPath $local) { return $local }
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

function Wait-TcpPort([int]$Port, [int]$TimeoutSec = 180, [string]$Label = '') {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-TcpPort $Port) { return $true }
    Start-Sleep -Seconds 2
  }
  throw "Timeout esperando ${Label}127.0.0.1:${Port} (${TimeoutSec}s)"
}

function Stop-PortListeners([int[]]$Ports) {
  foreach ($port in $Ports) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
      }
  }
  Start-Sleep -Seconds 2
}

function Get-LanIPv4 {
  $addr = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike '127.*' -and
      $_.IPAddress -notlike '169.254.*' -and
      $_.PrefixOrigin -ne 'WellKnown'
    } |
    Sort-Object -Property InterfaceMetric |
    Select-Object -First 1 -ExpandProperty IPAddress
  if ($addr) { return $addr }
  return '127.0.0.1'
}

function Ensure-EnvFiles {
  $envLocal = Join-Path $projectRoot 'apps\web2\.env.local'
  $envEmu = Join-Path $projectRoot 'apps\web2\.env.emulator'
  if (-not (Test-Path -LiteralPath $envLocal)) {
    if (Test-Path -LiteralPath $envEmu) {
      Copy-Item -LiteralPath $envEmu -Destination $envLocal -Force
      Write-Step '  Creado apps\web2\.env.local desde .env.emulator' 'Green'
    } else {
      Write-Step '  AVISO: falta apps\web2\.env.local — copiá .env.emulator manualmente' 'Yellow'
    }
  }

  $fnEnv = Join-Path $projectRoot 'apps\functions\.env'
  $fnExample = Join-Path $projectRoot 'apps\functions\.env.example'
  if (-not (Test-Path -LiteralPath $fnEnv)) {
    if (Test-Path -LiteralPath $fnExample) {
      Copy-Item -LiteralPath $fnExample -Destination $fnEnv -Force
      Write-Step '  Creado apps\functions\.env — completá GEMINI_API_KEY para el asistente' 'Yellow'
    }
  } elseif (-not (Select-String -Path $fnEnv -Pattern 'GEMINI_API_KEY=\S+' -Quiet)) {
    Write-Step '  AVISO: apps\functions\.env sin GEMINI_API_KEY — el asistente no responderá' 'Yellow'
  }

  $mobEnv = Join-Path $projectRoot 'apps\mobile-guardia\.env'
  $mobExample = Join-Path $projectRoot 'apps\mobile-guardia\.env.example'
  if (-not (Test-Path -LiteralPath $mobEnv)) {
    if (Test-Path -LiteralPath $mobExample) {
      Copy-Item -LiteralPath $mobExample -Destination $mobEnv -Force
      Write-Step '  Creado apps\mobile-guardia\.env desde .env.example' 'Green'
    } else {
      Write-Step '  AVISO: falta apps\mobile-guardia\.env' 'Yellow'
    }
  }
}

Write-Host ''
Write-Step 'COSP Lab — arranque interactivo'
Write-Step "Repo: $projectRoot"
Write-Host ''

$npm = Find-NpmCmd
if (-not $npm) {
  Write-Step 'ERROR: npm no encontrado. Instalá Node.js (Program Files\nodejs).' 'Red'
  exit 1
}
$nodeDir = Split-Path -Parent $npm
$nodeExe = Join-Path $nodeDir 'node.exe'

if (-not (Test-Path (Join-Path $projectRoot 'node_modules'))) {
  Write-Step 'Instalando dependencias (npm install)...' 'Yellow'
  & $npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Ensure-EnvFiles

if ($Restart) {
  Write-Step 'Reiniciando: liberando puertos 8080, 9099, 5001, 4000, 4400, 3010, 8081, 9199...' 'Yellow'
  Stop-PortListeners @(8080, 9099, 5001, 4000, 4400, 3010, 8081, 9199)
}

$emulatorsUp = (Test-TcpPort 8080) -and (Test-TcpPort 9099)
$functionsUp = Test-TcpPort 5001

if (-not $emulatorsUp -or (-not $functionsUp -and -not $Restart)) {
  if ($emulatorsUp -and -not $functionsUp) {
    Write-Step 'Firestore/Auth activos pero Functions (:5001) no — relanzando emuladores completos...' 'Yellow'
    Stop-PortListeners @(8080, 9099, 5001, 4000, 4400)
    $emulatorsUp = $false
  }
}

if (-not $emulatorsUp) {
  Write-Step 'Abriendo emuladores (ventana nueva)...' 'Yellow'
  Write-Host '  UI:        http://127.0.0.1:4000' -ForegroundColor DarkGray
  Write-Host '  Firestore: 8080 | Auth: 9099 | Functions: 5001' -ForegroundColor DarkGray
  Start-Process cmd.exe -ArgumentList @('/k', "cd /d `"$projectRoot`" && title COSP Emulators && npm run emulators")
  Write-Step 'Esperando emuladores (8080 Firestore, 9099 Auth, 5001 Functions)...' 'DarkGray'
  try {
    Wait-TcpPort 8080 240 'Firestore '
    Wait-TcpPort 9099 120 'Auth '
    Wait-TcpPort 5001 180 'Functions '
  } catch {
    Write-Step "ERROR: $_" 'Red'
    Write-Step 'Revisá la ventana COSP Emulators (JDK 21+, firebase-tools, GEMINI en apps/functions/.env).' 'Yellow'
    exit 1
  }
  Write-Step '  Emuladores listos.' 'Green'
} else {
  Write-Step 'Emuladores ya activos — omitiendo arranque.' 'Green'
}

if (-not (Test-TcpPort 3010)) {
  Write-Step 'Abriendo puente de backups (:3010)...' 'Yellow'
  Start-Process cmd.exe -ArgumentList @('/k', "cd /d `"$projectRoot`" && title COSP Bridge :3010 && npm run emulator-bridge")
  try {
    Wait-TcpPort 3010 30 'Bridge '
    Write-Step '  Puente backup listo.' 'Green'
  } catch {
    Write-Step 'AVISO: puente :3010 no respondió — para importar backups: npm run emulator-bridge' 'Yellow'
  }
} else {
  Write-Step 'Puente backup (:3010) ya activo.' 'Green'
}

if (-not $NoSeed) {
  Write-Step 'Sembrando admin + guardia (npm run seed)...' 'Yellow'
  & $nodeExe (Join-Path $projectRoot 'scripts\seed-lab.js')
  if ($LASTEXITCODE -ne 0) {
    Write-Step 'Seed falló — podés reintentar: npm run seed' 'Yellow'
  } else {
    Write-Step '  Seed OK (admin@bacarsa.com.ar / admin1234)' 'Green'
  }
}

$devPortBusy = Test-TcpPort $devPort
if (-not $devPortBusy) {
  Write-Step 'Abriendo Next.js (ventana nueva)...' 'Yellow'
  $devCmd = if ($Network) {
    'npm --prefix apps/web2 run dev -- -H 0.0.0.0'
  } else {
    'npm run dev'
  }
  Start-Process cmd.exe -ArgumentList @('/k', "cd /d `"$projectRoot`" && title COSP Next :$devPort && $devCmd")
  Write-Step "Esperando http://127.0.0.1:$devPort ..." 'DarkGray'
  try {
    Wait-TcpPort $devPort 90 'Next '
  } catch {
    Write-Step "Next aún iniciando — abrí http://localhost:$devPort en unos segundos." 'Yellow'
  }
} else {
  Write-Step "Puerto $devPort ocupado — asumo que Next ya corre." 'Green'
}

if (-not $NoCursor) {
  $cursor = Find-CursorExe
  if ($cursor) {
    Write-Step 'Abriendo Cursor en el repo...' 'Yellow'
    Start-Process -FilePath $cursor -ArgumentList @($projectRoot)
  } else {
    Write-Step 'Cursor no encontrado — abrí manualmente la carpeta del repo.' 'Yellow'
  }
}

if (-not $NoBrowser) {
  Start-Sleep -Seconds 2
  Start-Process "http://127.0.0.1:$devPort"
}

$expoPort = 8081
$lanIp = Get-LanIPv4
if ($WithExpo) {
  if (-not (Test-TcpPort $expoPort)) {
    Write-Step 'Abriendo Expo — app móvil guardia (ventana nueva)...' 'Yellow'
    $expoCmd = 'npx expo start -c --host lan'
    $mobileRoot = Join-Path $projectRoot 'apps\mobile-guardia'
    Start-Process cmd.exe -ArgumentList @(
      '/k',
      "cd /d `"$mobileRoot`" && title COSP Expo :8081 && $expoCmd"
    )
    Write-Step "Esperando Metro http://127.0.0.1:$expoPort ..." 'DarkGray'
    try {
      Wait-TcpPort $expoPort 120 'Expo '
      Write-Step '  Expo listo — escaneá QR en la ventana o Expo Go.' 'Green'
    } catch {
      Write-Step 'AVISO: Metro aún inicia — revisá la ventana COSP Expo :8081' 'Yellow'
    }
  } else {
    Write-Step "Puerto $expoPort ocupado — asumo que Expo ya corre." 'Green'
  }
}

Write-Host ''
Write-Step 'Listo.' 'Green'
Write-Host "  App web:    http://localhost:$devPort" -ForegroundColor White
Write-Host '  Emuladores: http://127.0.0.1:4000' -ForegroundColor White
if ($WithExpo) {
  Write-Host "  Expo (LAN): exp://$lanIp`:$expoPort" -ForegroundColor White
  Write-Host "  Expo (PC):  http://localhost:$expoPort" -ForegroundColor White
  Write-Host '  Guardia:    guardia@bacarsa.com.ar / guardia1234' -ForegroundColor White
}
Write-Host '  Login web:  admin@bacarsa.com.ar / admin1234' -ForegroundColor White
Write-Host ''
Write-Host 'Opciones del script:' -ForegroundColor DarkGray
Write-Host '  -NoSeed     no ejecuta seed' -ForegroundColor DarkGray
Write-Host '  -NoCursor   no abre Cursor' -ForegroundColor DarkGray
Write-Host '  -Restart    mata procesos en puertos lab y relanza' -ForegroundColor DarkGray
Write-Host '  -Network    Next en 0.0.0.0 (acceso LAN)' -ForegroundColor DarkGray
Write-Host '  -WithExpo    abre Expo (mobile-guardia) en :8081 LAN' -ForegroundColor DarkGray
Write-Host ''
