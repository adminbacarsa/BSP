# ========== EDITÁ SOLO ESTOS VALORES ==========
$PROYECTO_FIREBASE = "comtroldata"       # ej: cronoapp-abc123 (ID del proyecto en Firebase Console)
$TOKEN_REGISTRO   = "0024472243000905$"      # el de nvr_config/registration en Firestore

$NVR_ID          = "8F0001CPAZ21EFD"            # ID unico del NVR (ej. serial o nombre)
$NVR_NAME        = "NVRBacar"
$NVR_IP          = "192.168.0.102"           # IP del NVR en la red
$NVR_USER        = "admin"
$NVR_PASSWORD    = "18July75$"         # contraseña del NVR
$CHANNEL_COUNT   = 16                 # cantidad de canales
# Cliente y objetivo: se asignan a la NVR y a TODOS los canales
$CLIENT_ID       = ""                # ej: "abc123" (ID del cliente en la plataforma)
$OBJECTIVE_ID   = ""                # ej: "obj456" (ID del objetivo)
# ==============================================

$url = "https://us-central1-$PROYECTO_FIREBASE.cloudfunctions.net/nvrOnboard"
$headers = @{
    "Content-Type"  = "application/json"
    "Authorization" = "Bearer $TOKEN_REGISTRO"
}
$bodyObj = @{
    nvr_id        = $NVR_ID
    nvr_name      = $NVR_NAME
    nvr_ip        = $NVR_IP
    nvr_user      = $NVR_USER
    nvr_password  = $NVR_PASSWORD
    channel_count = $CHANNEL_COUNT
}
if ($CLIENT_ID)    { $bodyObj.client_id    = $CLIENT_ID }
if ($OBJECTIVE_ID) { $bodyObj.objective_id = $OBJECTIVE_ID }
$body = $bodyObj | ConvertTo-Json

Write-Host "Registrando NVR en la plataforma..." -ForegroundColor Cyan
try {
    $resp = Invoke-RestMethod -Uri $url -Method POST -Headers $headers -Body $body
    Write-Host "OK. Respuesta:" -ForegroundColor Green
    $resp | ConvertTo-Json -Depth 5
    if ($resp.agent_secret) {
        Write-Host "`nCopiate este agent_secret en config.properties como platform.key" -ForegroundColor Yellow
        Write-Host $resp.agent_secret -ForegroundColor White
    }
} catch {
    Write-Host "Error:" -ForegroundColor Red
    $_.Exception.Message
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
}
