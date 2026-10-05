# Pasa las variables del robot ARCA al servicio de Windows "n8n" (nssm) y lo reinicia.
# Las toma de las variables de MÁQUINA que dejó instalar.ps1 (la clave del robot no se escribe acá).
# Uso (PowerShell como administrador): powershell -ExecutionPolicy Bypass -File D:\APP\cronoapp\scripts\arca-robot\servicio-n8n-env.ps1
$ErrorActionPreference = 'Stop'
$nssm = 'D:\APP\nssm\win64\nssm.exe'
if (-not (Test-Path $nssm)) { throw "No encuentro $nssm" }

$claves = @(
  'ARCA_ENVIOS_URL', 'ARCA_TXT_DIR', 'ARCA_SHOTS_DIR', 'COSP_REPO', 'ARCA_SIMULACION',
  'ARCA_ROBOT_REINTENTOS', 'ARCA_ROBOT_KEY', 'NODES_EXCLUDE', 'N8N_BLOCK_ENV_ACCESS_IN_NODE', 'N8N_ROBOT_WEBHOOK'
)

# Lo que el servicio ya tenía (N8N_HOST, N8N_PROTOCOL, etc.) se conserva.
$actual = & $nssm get n8n AppEnvironmentExtra 2>$null
$mapa = [ordered]@{}
foreach ($linea in ($actual -split "`r?`n")) {
  $l = ($linea -replace "`0", '').Trim()
  if ($l -match '^([^=]+)=(.*)$') { $mapa[$Matches[1]] = $Matches[2] }
}

$faltan = @()
foreach ($k in $claves) {
  $v = [Environment]::GetEnvironmentVariable($k, 'Machine')
  if ([string]::IsNullOrEmpty($v)) { $faltan += $k; continue }
  $mapa[$k] = $v
}
if ($faltan.Count) { Write-Host "AVISO: faltan variables de máquina (corré antes INSTALAR-ROBOT-ARCA.cmd): $($faltan -join ', ')" -ForegroundColor Yellow }

$pares = @($mapa.Keys | ForEach-Object { "$_=$($mapa[$_])" })
& $nssm set n8n AppEnvironmentExtra @pares | Out-Null
Write-Host "Servicio n8n: variables cargadas ($($mapa.Keys -join ', '))."

# El n8n duplicado de PM2 (usuario Soporte) choca con el puerto 5678 y se reinicia sin parar: se detiene, no se borra.
$pm2 = 'C:\Users\Soporte\AppData\Roaming\npm\pm2.cmd'
if (Test-Path $pm2) {
  $env:PM2_HOME = 'C:\Users\Soporte\.pm2'
  cmd /c "`"$pm2`" stop n8n" | Out-Null
  cmd /c "`"$pm2`" save" | Out-Null
  Write-Host 'PM2: n8n duplicado detenido (caddy y ping-api siguen).'
}

Restart-Service n8n
Write-Host 'Servicio n8n reiniciado. Esperando que responda...'
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 4
  try { if ((Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/healthz' -TimeoutSec 4).StatusCode -eq 200) { $ok = $true; break } } catch {}
}
if ($ok) { Write-Host 'LISTO: n8n responde.' -ForegroundColor Green } else { Write-Host 'n8n no respondió en 2 minutos: mandame captura.' -ForegroundColor Red }
Read-Host 'Enter para cerrar'
