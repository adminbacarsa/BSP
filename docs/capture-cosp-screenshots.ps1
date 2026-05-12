# Regenera PNG para docs/presentacion-cosp-v1.html
# Uso: desde repo:  pwsh -File docs/capture-cosp-screenshots.ps1
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "presentacion-cosp-capturas"
$base = "https://comtroldata.web.app"
Set-Location $dir
npx --yes playwright@1.51.0 install chromium | Out-Host
$shots = @(
  @{ path = "/login/"; file = "portada.png" },
  @{ path = "/admin/dashboard/"; file = "dashboard.png" },
  @{ path = "/admin/operaciones/"; file = "operaciones.png" },
  @{ path = "/admin/planificacion/"; file = "planificacion.png" },
  @{ path = "/admin/crm/"; file = "crm.png" },
  @{ path = "/admin/servicios/"; file = "servicios.png" },
  @{ path = "/admin/reportes/"; file = "reportes.png" },
  @{ path = "/admin/analisis/"; file = "analisis.png" },
  @{ path = "/admin/empleados/"; file = "empleados.png" },
  @{ path = "/admin/rrhh/"; file = "rrhh.png" },
  @{ path = "/admin/configuracion/"; file = "configuracion.png" },
  @{ path = "/admin/guia/"; file = "guia.png" },
  @{ path = "/empleado/dashboard/"; file = "empleado.png" }
)
foreach ($s in $shots) {
  $url = $base + $s.path
  Write-Host ">> $url -> $($s.file)"
  npx --yes playwright@1.51.0 screenshot --viewport-size="1440,900" --timeout=90000 --wait-for-timeout=2500 $url $s.file
}
Write-Host "Listo. PNG en $dir"
