# Abre puertos del lab COSP en el firewall de Windows (perfil Privado).
# Ejecutar como Administrador desde la raíz del repo:
#   powershell -ExecutionPolicy Bypass -File scripts\open-expo-lab-firewall.ps1

$ErrorActionPreference = 'Stop'
$ruleName = 'COSP Lab Expo y Emuladores'

$ports = @(8081, 8080, 9099, 5001, 9199, 4000, 4400) | Sort-Object -Unique

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Regla '$ruleName' ya existe. Actualizando puertos..."
  Remove-NetFirewallRule -DisplayName $ruleName
}

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort $ports `
  -Profile Private `
  -Description 'Metro Expo (8081) y emuladores Firebase para app mobile-guardia y lab COSP'

Write-Host "OK: TCP $($ports -join ',') permitido en red Privada."
Write-Host "Celular y PC deben estar en la misma Wi-Fi. Arrancá Expo con: cd apps\mobile-guardia; npm run start:lan"
