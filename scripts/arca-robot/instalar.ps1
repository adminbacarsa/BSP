#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$Repo = 'D:\APP\cronoapp'
$RobotDir = Join-Path $Repo 'scripts\arca-robot'
$TxtDir = 'D:\arca-txt'
$ShotsDir = 'D:\arca-txt\shots'
$SecretosDir = 'D:\secretos'
$ClavesPath = 'D:\secretos\arca-claves.json'
$EjemploPath = 'D:\secretos\arca-claves.example.json'
$LogPath = Join-Path $TxtDir 'instalar.log'
$OverridePath = 'D:\secretos\n8n-compose.override.yml'
$Placeholder = 'PEGAR_LA_CLAVE_FISCAL_ACA'

$PublicVars = [ordered]@{
    ARCA_ENVIOS_URL              = 'https://us-central1-comtroldata.cloudfunctions.net/arcaEnviosApi'
    ARCA_TXT_DIR                 = 'D:\arca-txt'
    ARCA_SHOTS_DIR               = 'D:\arca-txt\shots'
    COSP_REPO                    = 'D:\APP\cronoapp'
    ARCA_CLAVES_PATH             = 'D:\secretos\arca-claves.json'
    ARCA_SIMULACION              = '1'
    ARCA_ROBOT_REINTENTOS        = '3'
    NODES_EXCLUDE                = '[]'
    N8N_BLOCK_ENV_ACCESS_IN_NODE = 'false'
}

$script:Hechos = New-Object System.Collections.Generic.List[string]
$script:Faltan = New-Object System.Collections.Generic.List[string]

function Add-Hecho([string]$Texto) {
    $script:Hechos.Add($Texto)
    Write-Log $Texto
}

function Add-Falta([string]$Texto) {
    $script:Faltan.Add($Texto)
    Write-Log "PENDIENTE: $Texto"
}

function Write-Log([string]$Mensaje) {
    $linea = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Mensaje
    Write-Host $linea
    try {
        $dir = Split-Path -Parent $LogPath
        if (-not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        [System.IO.File]::AppendAllText($LogPath, $linea + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding $false))
    } catch {
        Write-Host "No pude escribir el log: $($_.Exception.Message)"
    }
}

function Test-EsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = New-Object Security.Principal.WindowsPrincipal($id)
    return $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function ConvertFrom-SecureText([Security.SecureString]$Secreto) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secreto)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Test-ClaveRobotValida([string]$Valor) {
    if ([string]::IsNullOrWhiteSpace($Valor)) { return $false }
    if ($Valor -match "[\r\n\x00]") { return $false }
    return $true
}

function Get-FirstToken([string]$PathName) {
    if ([string]::IsNullOrWhiteSpace($PathName)) { return '' }
    if ($PathName -match '^"([^"]+)"') { return $Matches[1] }
    return ($PathName -split '\s+', 2)[0]
}

function Invoke-ToolText {
    param([string]$Exe, [string]$Arguments, [int]$TimeoutSec = 20)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = $Arguments
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $outTask = $proc.StandardOutput.ReadToEndAsync()
    $errTask = $proc.StandardError.ReadToEndAsync()
    if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
        try { $proc.Kill() } catch { }
        return $null
    }
    [void]$proc.WaitForExit()
    return [pscustomobject]@{
        Code = $proc.ExitCode
        Out  = $outTask.Result
        Err  = $errTask.Result
    }
}

function Get-ProcessOwner([int]$ProcessId) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $p) { return '' }
    $owner = Invoke-CimMethod -InputObject $p -MethodName GetOwner -ErrorAction SilentlyContinue
    if (-not $owner -or $owner.ReturnValue -ne 0) { return '' }
    if ($owner.Domain) { return "$($owner.Domain)\$($owner.User)" }
    return [string]$owner.User
}

function Get-ParentProcess([int]$ProcessId) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $p -or -not $p.ParentProcessId) { return $null }
    return Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)" -ErrorAction SilentlyContinue
}

function New-Runtime {
    param(
        [string]$Modo,
        [string]$Resumen,
        [string]$Cuenta = '',
        [string]$Nombre = ''
    )
    return [pscustomobject]@{
        Modo            = $Modo
        Resumen         = $Resumen
        Cuenta          = $Cuenta
        Nombre          = $Nombre
        ServiceName     = ''
        XmlPath         = ''
        Pm2Name         = ''
        TaskName        = ''
        TaskPath        = '\'
        ProcessId       = 0
        ExecutablePath  = ''
        Arguments       = ''
        ContainerId     = ''
        ComposeFile     = ''
        ComposeDir      = ''
        ComposeService  = ''
        LinuxContainer  = $false
    }
}

function Find-DockerN8n {
    $lista = @()
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) { return $lista }
    $ps = Invoke-ToolText -Exe $docker.Source -Arguments 'ps --format "{{.ID}}|{{.Image}}|{{.Names}}"' -TimeoutSec 20
    if (-not $ps -or $ps.Code -ne 0) {
        Write-Log 'Docker esta instalado pero el motor no respondió. Sigo con el resto de la detección.'
        return $lista
    }
    foreach ($linea in ($ps.Out -split "[\r\n]+")) {
        if ([string]::IsNullOrWhiteSpace($linea)) { continue }
        $trozos = $linea -split '\|', 3
        if ($trozos.Count -lt 3) { continue }
        $id = $trozos[0].Trim()
        $image = $trozos[1].Trim()
        $names = $trozos[2].Trim()
        if ($image -notmatch 'n8n' -and $names -notmatch 'n8n') { continue }
        $rt = New-Runtime -Modo 'docker' -Nombre $names -Resumen "Docker Desktop, contenedor $names ($image)"
        $rt.ContainerId = $id
        $insp = Invoke-ToolText -Exe $docker.Source -Arguments "inspect $id" -TimeoutSec 25
        if ($insp -and $insp.Code -eq 0 -and $insp.Out) {
            try {
                $doc = $insp.Out | ConvertFrom-Json
                $item = @($doc)[0]
                $labels = $item.Config.Labels
                if ($labels) {
                    $rt.ComposeDir = [string]$labels.'com.docker.compose.project.working_dir'
                    $cfg = [string]$labels.'com.docker.compose.project.config_files'
                    if ($cfg) { $rt.ComposeFile = ($cfg -split ',')[0].Trim() }
                    $rt.ComposeService = [string]$labels.'com.docker.compose.service'
                }
                $plat = [string]$item.Platform
                if ($plat -match 'linux' -or $image -match 'n8nio/n8n') { $rt.LinuxContainer = $true }
                $user = [string]$item.Config.User
                if ($user) { $rt.Cuenta = $user } else { $rt.Cuenta = 'NT AUTHORITY\SYSTEM' }
            } catch {
                Write-Log "No pude leer docker inspect de ${id}: $($_.Exception.Message)"
            }
        }
        $lista += $rt
    }
    return $lista
}

function Test-ServicioEsNssm([string]$ServiceName) {
    $reg = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters"
    if (-not (Test-Path -LiteralPath $reg)) { return $false }
    $prop = Get-ItemProperty -LiteralPath $reg -ErrorAction SilentlyContinue
    if (-not $prop) { return $false }
    return $null -ne $prop.PSObject.Properties['Application']
}

function Get-NssmTexto([string]$ServiceName) {
    $reg = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters"
    if (-not (Test-Path -LiteralPath $reg)) { return '' }
    $prop = Get-ItemProperty -LiteralPath $reg -ErrorAction SilentlyContinue
    $app = ''
    $paramLinea = ''
    if ($prop.PSObject.Properties['Application']) { $app = [string]$prop.Application }
    if ($prop.PSObject.Properties['AppParameters']) { $paramLinea = [string]$prop.AppParameters }
    return "$app $paramLinea"
}

function Get-WinswXml([string]$PathName) {
    $exe = Get-FirstToken $PathName
    if (-not $exe) { return '' }
    $xml = [System.IO.Path]::ChangeExtension($exe, '.xml')
    if (-not (Test-Path -LiteralPath $xml)) { return '' }
    $head = Get-Content -LiteralPath $xml -TotalCount 8 -ErrorAction SilentlyContinue
    if (($head -join "`n") -notmatch '<service') { return '' }
    return $xml
}

function Test-TextoN8n([string]$Texto) {
    return ($Texto -match '(?i)(^|[^a-z0-9])n8n([^a-z0-9]|$)')
}

function Find-ServiciosN8n {
    $lista = @()
    $vistos = @{}
    $servicios = @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue)
    $nodos = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { Test-TextoN8n $_.CommandLine })
    foreach ($nodo in $nodos) {
        $cadena = @($nodo)
        $padreId = $nodo.ParentProcessId
        $guard = 0
        while ($padreId -and $guard -lt 6) {
            $padre = Get-CimInstance Win32_Process -Filter "ProcessId = $padreId" -ErrorAction SilentlyContinue
            if (-not $padre) { break }
            $cadena += $padre
            if ($padre.ParentProcessId -eq $padre.ProcessId) { break }
            $padreId = $padre.ParentProcessId
            $guard++
        }
        $pids = @($cadena | ForEach-Object { $_.ProcessId })
        foreach ($svc in $servicios) {
            if ($pids -contains [int]$svc.ProcessId) { $vistos[$svc.Name] = $true }
        }
    }
    foreach ($svc in $servicios) {
        $blob = "$($svc.Name) $($svc.DisplayName) $($svc.PathName) $(Get-NssmTexto $svc.Name)"
        $xml = Get-WinswXml $svc.PathName
        if ($xml) {
            $blob += ' ' + (Get-Content -LiteralPath $xml -Raw -ErrorAction SilentlyContinue)
        }
        $marca = (Test-TextoN8n $blob) -or $vistos.ContainsKey($svc.Name)
        if (-not $marca) { continue }
        $modo = 'servicio'
        if (Test-ServicioEsNssm $svc.Name -or $svc.PathName -match '(?i)nssm') { $modo = 'servicio-nssm' }
        elseif ($xml) { $modo = 'servicio-winsw' }
        $rt = New-Runtime -Modo $modo -Nombre $svc.Name -Cuenta ([string]$svc.StartName) -Resumen "servicio Windows $modo '$($svc.Name)' ($($svc.StartName))"
        $rt.ServiceName = $svc.Name
        $rt.XmlPath = $xml
        $lista += $rt
    }
    return $lista
}

function Find-Pm2N8n {
    $lista = @()
    $pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
    if (-not $pm2) { return $lista }
    $cmd = $pm2.Source
    $paramLinea = 'jlist'
    if ($cmd -match '(?i)\.(cmd|bat)$') {
        $paramLinea = "/c `"$cmd`" jlist"
        $cmd = $env:ComSpec
    }
    $raw = Invoke-ToolText -Exe $cmd -Arguments $paramLinea -TimeoutSec 25
    if (-not $raw -or [string]::IsNullOrWhiteSpace($raw.Out)) { return $lista }
    $json = $raw.Out.Trim()
    $inicio = $json.IndexOf('[')
    if ($inicio -lt 0) { return $lista }
    $json = $json.Substring($inicio)
    try { $procs = @($json | ConvertFrom-Json) } catch { return $lista }
    foreach ($p in $procs) {
        if (-not $p) { continue }
        $name = [string]$p.name
        $exec = ''
        $pargs = ''
        if ($p.pm2_env) {
            $exec = [string]$p.pm2_env.pm_exec_path
            if ($p.pm2_env.args) { $pargs = [string]$p.pm2_env.args }
        }
        if (-not (Test-TextoN8n "$name $exec $pargs")) { continue }
        $rt = New-Runtime -Modo 'pm2' -Nombre $name -Resumen "PM2, proceso '$name'"
        $rt.Pm2Name = $name
        $rt.Cuenta = Get-ProcessOwner -ProcessId ([int]$p.pid)
        $lista += $rt
    }
    return $lista
}

function Find-TareasN8n {
    $lista = @()
    $tareas = @(Get-ScheduledTask -ErrorAction SilentlyContinue)
    foreach ($t in $tareas) {
        if ($t.State -eq 'Disabled') { continue }
        foreach ($accion in @($t.Actions)) {
            $blob = "$($accion.Execute) $($accion.Arguments)"
            if (-not (Test-TextoN8n $blob)) { continue }
            $cuenta = ''
            if ($t.Principal) { $cuenta = [string]$t.Principal.UserId }
            $rt = New-Runtime -Modo 'tarea' -Nombre $t.TaskName -Cuenta $cuenta -Resumen "tarea programada '$($t.TaskPath)$($t.TaskName)' ($cuenta)"
            $rt.TaskName = $t.TaskName
            $rt.TaskPath = $t.TaskPath
            $lista += $rt
            break
        }
    }
    return $lista
}

function Find-NpmN8n {
    $lista = @()
    $nodos = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)
    foreach ($nodo in $nodos) {
        if (-not (Test-TextoN8n $nodo.CommandLine)) { continue }
        if ($nodo.CommandLine -match '(?i)pm2') { continue }
        $padre = Get-ParentProcess -ProcessId $nodo.ProcessId
        $padreNombre = ''
        $padreCmd = ''
        if ($padre) {
            $padreNombre = [string]$padre.Name
            $padreCmd = [string]$padre.CommandLine
        }
        if ($padreCmd -match '(?i)pm2' -or $padreNombre -match '(?i)^nssm') { continue }
        if ($padreNombre -match '(?i)^(services|svchost|taskeng)\.exe$') { continue }
        $exe = [string]$nodo.ExecutablePath
        $cmd = [string]$nodo.CommandLine
        $argumentos = ''
        if ($cmd.StartsWith('"')) {
            $fin = $cmd.IndexOf('"', 1)
            if ($fin -gt 0) { $argumentos = $cmd.Substring($fin + 1).Trim() }
        } elseif ($exe -and $cmd.StartsWith($exe)) {
            $argumentos = $cmd.Substring($exe.Length).Trim()
        } else {
            $argumentos = $cmd
        }
        $cuenta = Get-ProcessOwner -ProcessId $nodo.ProcessId
        $rt = New-Runtime -Modo 'npm' -Nombre 'n8n' -Cuenta $cuenta -Resumen "proceso node 'n8n start' (pid $($nodo.ProcessId), $cuenta)"
        $rt.ProcessId = [int]$nodo.ProcessId
        $rt.ExecutablePath = $exe
        $rt.Arguments = $argumentos
        $lista += $rt
    }
    return $lista
}

function Get-N8nRuntime {
    $todos = @()
    $todos += @(Find-DockerN8n)
    $todos += @(Find-ServiciosN8n)
    $todos += @(Find-Pm2N8n)
    $todos += @(Find-TareasN8n)
    if ($todos.Count -eq 0) { $todos += @(Find-NpmN8n) }
    $unicos = @{}
    foreach ($item in $todos) {
        $clave = "$($item.Modo)|$($item.Nombre)|$($item.ContainerId)|$($item.ServiceName)|$($item.TaskPath)$($item.TaskName)"
        $unicos[$clave] = $item
    }
    $lista = @($unicos.Values)
    if ($lista.Count -eq 0) {
        $rt = New-Runtime -Modo 'desconocido' -Resumen 'no encontré un n8n en marcha'
        return $rt
    }
    if ($lista.Count -gt 1) {
        $texto = ($lista | ForEach-Object { $_.Resumen }) -join '; '
        $rt = New-Runtime -Modo 'desconocido' -Resumen $texto
        return $rt
    }
    return $lista[0]
}

$script:Notas = New-Object System.Collections.Generic.List[string]

function Add-Nota([string]$Texto) {
    $script:Notas.Add($Texto)
    Write-Log "NOTA: $Texto"
}

function Assert-FueraDelRepo([string]$Ruta) {
    $full = [System.IO.Path]::GetFullPath($Ruta)
    $repoFull = [System.IO.Path]::GetFullPath($Repo)
    if ($full.StartsWith($repoFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "No escribo secretos dentro del repo ($full)."
    }
}

function Get-NssmMap([string]$ServiceName) {
    $map = @{}
    $reg = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters"
    if (-not (Test-Path -LiteralPath $reg)) { return $map }
    $prop = Get-ItemProperty -LiteralPath $reg -ErrorAction SilentlyContinue
    if (-not $prop -or -not $prop.PSObject.Properties['AppEnvironmentExtra']) { return $map }
    foreach ($linea in @($prop.AppEnvironmentExtra)) {
        if ([string]::IsNullOrWhiteSpace($linea)) { continue }
        $eq = $linea.IndexOf('=')
        if ($eq -lt 1) { continue }
        $map[$linea.Substring(0, $eq)] = $linea.Substring($eq + 1)
    }
    return $map
}

function Set-NssmMap([string]$ServiceName, $Mapa) {
    $reg = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters"
    if (-not (Test-Path -LiteralPath $reg)) { throw "No existe el registro de nssm para $ServiceName." }
    $actual = Get-NssmMap $ServiceName
    foreach ($k in @($Mapa.Keys)) { $actual[$k] = [string]$Mapa[$k] }
    $lineas = New-Object System.Collections.Generic.List[string]
    foreach ($k in @($actual.Keys)) { $lineas.Add("$k=$($actual[$k])") }
    New-ItemProperty -LiteralPath $reg -Name 'AppEnvironmentExtra' -PropertyType MultiString -Value $lineas.ToArray() -Force | Out-Null
}

function Get-WinswMap([string]$XmlPath) {
    $map = @{}
    if (-not (Test-Path -LiteralPath $XmlPath)) { return $map }
    [xml]$doc = Get-Content -LiteralPath $XmlPath -Raw
    foreach ($env in @($doc.DocumentElement.env)) {
        if (-not $env) { continue }
        $nombre = $env.GetAttribute('name')
        if ($nombre) { $map[$nombre] = $env.GetAttribute('value') }
    }
    return $map
}

function Set-WinswMap([string]$XmlPath, $Mapa) {
    Assert-FueraDelRepo $XmlPath
    $backup = "$XmlPath.bak-arca"
    if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $XmlPath -Destination $backup }
    [xml]$doc = Get-Content -LiteralPath $XmlPath -Raw
    $raiz = $doc.DocumentElement
    foreach ($k in @($Mapa.Keys)) {
        $nodo = $null
        foreach ($env in @($raiz.env)) {
            if (-not $env) { continue }
            if ($env.GetAttribute('name') -eq [string]$k) { $nodo = $env; break }
        }
        if (-not $nodo) {
            $nodo = $doc.CreateElement('env')
            [void]$raiz.AppendChild($nodo)
            $nodo.SetAttribute('name', [string]$k)
        }
        $nodo.SetAttribute('value', [string]$Mapa[$k])
    }
    $doc.Save($XmlPath)
}

function Set-MachineMap($Mapa) {
    foreach ($k in @($Mapa.Keys)) {
        [Environment]::SetEnvironmentVariable([string]$k, [string]$Mapa[$k], 'Machine')
        Set-Item -Path "Env:$k" -Value ([string]$Mapa[$k])
    }
}

function Get-Pm2Dump {
    $pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
    if (-not $pm2) { return @() }
    $exe = $pm2.Source
    $paramLinea = 'jlist'
    if ($exe -match '(?i)\.(cmd|bat)$') {
        $paramLinea = "/c `"$exe`" jlist"
        $exe = $env:ComSpec
    }
    $raw = Invoke-ToolText -Exe $exe -Arguments $paramLinea -TimeoutSec 25
    if (-not $raw -or [string]::IsNullOrWhiteSpace($raw.Out)) { return @() }
    $json = $raw.Out.Trim()
    $inicio = $json.IndexOf('[')
    if ($inicio -lt 0) { return @() }
    try { return @(($json.Substring($inicio)) | ConvertFrom-Json) } catch { return @() }
}

function Get-Pm2EnvMap($Proc) {
    $map = @{}
    if (-not $Proc -or -not $Proc.pm2_env) { return $map }
    $skip = @{
        name = $true; status = $true; pm_id = $true; pm_pid = $true; pm_uptime = $true
        restart_time = $true; unstable_restarts = $true; created_at = $true
        pm_exec_path = $true; pm_cwd = $true; pm_out_log_path = $true; pm_err_log_path = $true
        pm_pid_path = $true; pm_log_path = $true; node_version = $true; version = $true
        exec_mode = $true; exec_interpreter = $true; instances = $true; vizion = $true
        autorestart = $true; autostart = $true; instance_var = $true; watch = $true
        username = $true; filter_env = $true; namespace = $true; kill_retry_time = $true
        windowsHide = $true; treekill = $true; automation = $true; pmx = $true
        vizion_running = $true; km_link = $true; prev_restart_delay = $true; exit_code = $true
        node_args = $true; merge_logs = $true; unique_id = $true; axm_actions = $true
        axm_monitor = $true; axm_options = $true; axm_dynamic = $true; env = $true
        args = $true; script = $true; interpreter = $true; pid = $true; versioning = $true
        max_memory_restart = $true; min_uptime = $true; listen_timeout = $true
        kill_timeout = $true; wait_ready = $true; out_file = $true; error_file = $true
        log_file = $true; pid_file = $true; source_map_support = $true; PM2_USAGE = $true
        PM2_JSON_PROCESSING = $true; _tree_pids = $true
    }
    if ($Proc.pm2_env.env) {
        foreach ($prop in $Proc.pm2_env.env.PSObject.Properties) {
            if ($prop.Value -is [string] -or $prop.Value -is [ValueType]) {
                $map[$prop.Name] = [string]$prop.Value
            }
        }
    }
    foreach ($prop in $Proc.pm2_env.PSObject.Properties) {
        if ($skip.ContainsKey($prop.Name)) { continue }
        if ($prop.Name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }
        if ($prop.Value -is [string] -or $prop.Value -is [int] -or $prop.Value -is [long] -or $prop.Value -is [bool]) {
            $map[$prop.Name] = [string]$prop.Value
        }
    }
    return $map
}

function Get-DockerEnvValue([string]$ContainerId, [string]$Clave) {
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) { return '' }
    $insp = Invoke-ToolText -Exe $docker.Source -Arguments "inspect $ContainerId" -TimeoutSec 25
    if (-not $insp -or $insp.Code -ne 0) { return '' }
    try {
        $item = @($insp.Out | ConvertFrom-Json)[0]
        foreach ($linea in @($item.Config.Env)) {
            if ($linea -like "$Clave=*") { return $linea.Substring($Clave.Length + 1) }
        }
    } catch { return '' }
    return ''
}

function Get-ClaveDesdeOverride {
    if (-not (Test-Path -LiteralPath $OverridePath)) { return '' }
    foreach ($linea in @(Get-Content -LiteralPath $OverridePath -ErrorAction SilentlyContinue)) {
        if ($linea -match '^\s*ARCA_ROBOT_KEY:\s*"(.*)"\s*$') {
            $bs = [string][char]92; $dq = [string][char]34; return $Matches[1].Replace($bs + $bs, $bs).Replace($bs + $dq, $dq)
        }
    }
    return ''
}

function Get-ExistingRobotKey($Rt) {
    switch ($Rt.Modo) {
        'servicio-nssm' { return [string](Get-NssmMap $Rt.ServiceName)['ARCA_ROBOT_KEY'] }
        'servicio-winsw' { return [string](Get-WinswMap $Rt.XmlPath)['ARCA_ROBOT_KEY'] }
        'servicio' { return [string][Environment]::GetEnvironmentVariable('ARCA_ROBOT_KEY', 'Machine') }
        'pm2' {
            foreach ($p in @(Get-Pm2Dump)) {
                if ([string]$p.name -eq $Rt.Pm2Name) {
                    return [string](Get-Pm2EnvMap $p)['ARCA_ROBOT_KEY']
                }
            }
            return ''
        }
        'tarea' { return [string][Environment]::GetEnvironmentVariable('ARCA_ROBOT_KEY', 'Machine') }
        'npm' { return [string][Environment]::GetEnvironmentVariable('ARCA_ROBOT_KEY', 'Machine') }
        'docker' {
            $enContenedor = Get-DockerEnvValue $Rt.ContainerId 'ARCA_ROBOT_KEY'
            if (Test-ClaveRobotValida $enContenedor) { return $enContenedor }
            return Get-ClaveDesdeOverride
        }
        default { return '' }
    }
}

function Read-ClaveRobot {
    Write-Host ''
    Write-Host 'ARCA_ROBOT_KEY (la misma que el secreto de Firebase). No se muestra y no se guarda en el repo.'
    $sec = Read-Host -AsSecureString -Prompt 'Pegala y presiona Enter'
    $plain = ConvertFrom-SecureText $sec
    if (-not (Test-ClaveRobotValida $plain)) {
        throw 'La clave está vacía o tiene un salto de línea. No la guardé.'
    }
    return $plain
}

function New-ArcaMap([string]$Clave) {
    $map = [ordered]@{}
    foreach ($k in $PublicVars.Keys) { $map[$k] = [string]$PublicVars[$k] }
    if (Test-ClaveRobotValida $Clave) { $map['ARCA_ROBOT_KEY'] = $Clave }
    return $map
}

function Write-DockerOverride([string]$Servicio, $Mapa) {
    Assert-FueraDelRepo $OverridePath
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('services:')
    [void]$sb.AppendLine("  ${Servicio}:")
    [void]$sb.AppendLine('    environment:')
    foreach ($k in @($Mapa.Keys)) {
        $valor = [string]$Mapa[$k]
        $valor = $valor.Replace('\', '\\').Replace('"', '\"')
        [void]$sb.AppendLine(('      {0}: "{1}"' -f $k, $valor))
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($OverridePath, $sb.ToString(), $utf8)
}

function Set-ArcaEnv($Rt, $Mapa) {
    switch ($Rt.Modo) {
        'servicio-nssm' {
            Set-NssmMap -ServiceName $Rt.ServiceName -Mapa $Mapa
            Add-Hecho "Variables en el servicio nssm '$($Rt.ServiceName)' (AppEnvironmentExtra). No toqué el resto."
        }
        'servicio-winsw' {
            Set-WinswMap -XmlPath $Rt.XmlPath -Mapa $Mapa
            Add-Hecho "Variables en el XML de WinSW $($Rt.XmlPath). No toqué el resto."
        }
        'servicio' {
            Set-MachineMap $Mapa
            Add-Hecho "Variables de equipo: el servicio '$($Rt.ServiceName)' no tiene bloque propio. No borré otras variables."
            Add-Nota 'Esas variables quedaron para todos los procesos de esta PC, porque el servicio no guarda entorno aparte.'
        }
        'pm2' {
            Add-Hecho "PM2 '$($Rt.Pm2Name)': las variables se aplican al reiniciar, conservando las que ya tenía el proceso."
        }
        'tarea' {
            Set-MachineMap $Mapa
            Add-Hecho "Variables de equipo para la tarea '$($Rt.TaskName)'. No borré otras variables."
            Add-Nota 'La tarea programada no tiene archivo de entorno: quedaron a nivel de equipo.'
        }
        'npm' {
            Set-MachineMap $Mapa
            Add-Hecho 'Variables de equipo para el proceso node de n8n. No borré otras variables.'
            Add-Nota 'El proceso suelto hereda el entorno de equipo. Si n8n tenía una variable solo en esa consola, hay que volver a definirla ahí.'
        }
        'docker' {
            if ([string]::IsNullOrWhiteSpace($Rt.ComposeFile) -or [string]::IsNullOrWhiteSpace($Rt.ComposeService)) {
                throw 'El contenedor no tiene etiquetas de docker compose. No lo recree.'
            }
            Write-DockerOverride -Servicio $Rt.ComposeService -Mapa $Mapa
            Add-Hecho "Override fuera del repo: $OverridePath (servicio $($Rt.ComposeService)). El compose original no se edito."
            Add-Nota "Si recreas el contenedor a mano, suma -f $OverridePath."
            if ($Rt.LinuxContainer) {
                Add-Nota 'n8n esta en un contenedor Linux. Execute Command corre adentro: D:\ y el Playwright del host no se ven salvo que el volumen este montado. No cambie volumenes.'
            }
        }
        default { throw "Modo no configurable: $($Rt.Modo)" }
    }
}

function Assert-FueraDelRepo([string]$Ruta) {
    $full = [System.IO.Path]::GetFullPath($Ruta).TrimEnd('\')
    $repoFull = [System.IO.Path]::GetFullPath($Repo).TrimEnd('\')
    $mismo = $full.Equals($repoFull, [System.StringComparison]::OrdinalIgnoreCase)
    $adentro = $full.StartsWith($repoFull + '\', [System.StringComparison]::OrdinalIgnoreCase)
    if ($mismo -or $adentro) { throw "No escribo secretos dentro del repo ($full)." }
}

function Test-CuentaWindows([string]$Cuenta) {
    if ([string]::IsNullOrWhiteSpace($Cuenta)) { return $false }
    if ($Cuenta -match '(?i)^(node|root|n8n)$') { return $false }
    if ($Cuenta -match '(?i)^(LocalSystem|SYSTEM|NT AUTHORITY\\SYSTEM)$') { return $false }
    try {
        $nt = New-Object System.Security.Principal.NTAccount($Cuenta)
        [void]$nt.Translate([System.Security.Principal.SecurityIdentifier])
        return $true
    } catch { return $false }
}

function Set-SecretosAcl([string]$Cuenta) {
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $hereda = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $nada = [System.Security.AccessControl.PropagationFlags]::None
    $full = [System.Security.AccessControl.FileSystemRights]::FullControl
    $allow = [System.Security.AccessControl.AccessControlType]::Allow
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $id = New-Object System.Security.Principal.SecurityIdentifier($sid)
        $regla = New-Object System.Security.AccessControl.FileSystemAccessRule($id, $full, $hereda, $nada, $allow)
        $acl.AddAccessRule($regla)
    }
    if (Test-CuentaWindows $Cuenta) {
        $nt = New-Object System.Security.Principal.NTAccount($Cuenta)
        $reglaCuenta = New-Object System.Security.AccessControl.FileSystemAccessRule($nt, $full, $hereda, $nada, $allow)
        $acl.AddAccessRule($reglaCuenta)
        Add-Hecho "D:\secretos queda para SYSTEM, Administradores y $Cuenta."
    } else {
        Add-Hecho 'D:\secretos queda para SYSTEM y Administradores.'
        if (-not [string]::IsNullOrWhiteSpace($Cuenta)) {
            Add-Nota "No di permiso a '$Cuenta' porque no es una cuenta de Windows de esta PC."
        }
    }
    Set-Acl -LiteralPath $SecretosDir -AclObject $acl
    Get-ChildItem -LiteralPath $SecretosDir -Force -ErrorAction SilentlyContinue | ForEach-Object {
        try { Set-Acl -LiteralPath $_.FullName -AclObject $acl } catch { }
    }
}

function Initialize-ArcaSecretos([string]$Cuenta) {
    if (-not (Test-Path -LiteralPath $SecretosDir)) {
        New-Item -ItemType Directory -Path $SecretosDir -Force | Out-Null
    }
    Set-SecretosAcl -Cuenta $Cuenta
    $ejemplo = "{`r`n  `"30000000000`": `"$Placeholder`"`r`n}`r`n"
    $utf8 = New-Object System.Text.UTF8Encoding $true
    if (-not (Test-Path -LiteralPath $EjemploPath)) {
        Assert-FueraDelRepo $EjemploPath
        [System.IO.File]::WriteAllText($EjemploPath, $ejemplo, $utf8)
        Add-Hecho "Creé $EjemploPath."
    } else {
        Add-Hecho "Ya estaba $EjemploPath. No lo pisé."
    }
    $abrir = $false
    if (-not (Test-Path -LiteralPath $ClavesPath)) {
        Copy-Item -LiteralPath $EjemploPath -Destination $ClavesPath
        Add-Hecho "Copié el ejemplo a $ClavesPath."
        $abrir = $true
    }
    $texto = ''
    if (Test-Path -LiteralPath $ClavesPath) { $texto = [System.IO.File]::ReadAllText($ClavesPath) }
    $vacio = [string]::IsNullOrWhiteSpace($texto)
    if ($vacio -or $texto -match [regex]::Escape($Placeholder)) {
        $abrir = $true
        Add-Nota "Completá el CUIT (solo dígitos) y la clave fiscal en $ClavesPath. No va en el repo ni en este chat."
    } else {
        Add-Hecho 'arca-claves.json ya tiene datos. No lo abrí ni lo pisé.'
    }
    try { Set-Acl -LiteralPath $ClavesPath -AclObject (Get-Acl -LiteralPath $SecretosDir) } catch { }
    if ($abrir) {
        Start-Process -FilePath 'notepad.exe' -ArgumentList $ClavesPath
        Add-Hecho 'Abrí el Bloc de notas con arca-claves.json.'
    }
}

function Install-ArcaRobotDeps {
    $scriptRobot = Join-Path $RobotDir 'subir.mjs'
    if (-not (Test-Path -LiteralPath $scriptRobot)) {
        Add-Falta "No está el repo en $Repo (falta scripts\arca-robot\subir.mjs). Sincroniza git y volvé a correr el instalador."
        return
    }
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Add-Falta 'No hay Node en el PATH. Instalá Node 18 o mas nuevo y volvé a correr el instalador.'
        return
    }
    $ver = & node -v
    Write-Log "Node $ver ($($node.Source))"
    if ($ver -match 'v(\d+)' -and [int]$Matches[1] -lt 18) {
        Add-Falta "Node $ver es anterior a 18. Seguí con la instalación, pero Playwright puede fallar."
    }
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        Add-Falta 'No hay npm en el PATH.'
        return
    }
    Push-Location $RobotDir
    try {
        & npm install --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm install salió con código $LASTEXITCODE" }
        & npx --yes playwright install chromium
        if ($LASTEXITCODE -ne 0) { throw "npx playwright install chromium salió con código $LASTEXITCODE" }
        Add-Hecho "Playwright y Chromium quedaron en $RobotDir."
    } catch {
        Add-Falta $_.Exception.Message
    } finally {
        Pop-Location
    }
}

function Get-BaseEnv {
    $map = @{}
    foreach ($name in @('Path','SystemRoot','ComSpec','PATHEXT','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PM2_HOME','ProgramData','SystemDrive','USERNAME','USERDOMAIN','PUBLIC','ALLUSERSPROFILE')) {
        $valor = [Environment]::GetEnvironmentVariable($name, 'Process')
        if ($valor) { $map[$name] = [string]$valor }
    }
    return $map
}

function Hide-Clave([string]$Texto) {
    if ([string]::IsNullOrEmpty($Texto)) { return '' }
    if ($script:ClaveRobot) { return $Texto.Replace($script:ClaveRobot, '***') }
    return $Texto
}

function Start-ConEntorno([string]$Exe, [string]$Argumentos, $Entorno, [int]$TimeoutSec) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = $Argumentos
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    if ($env:USERPROFILE) { $psi.WorkingDirectory = $env:USERPROFILE }
    $psi.EnvironmentVariables.Clear()
    $puestos = @{}
    foreach ($k in @($Entorno.Keys)) {
        $canon = $k.ToUpperInvariant()
        if ($puestos.ContainsKey($canon)) { continue }
        $puestos[$canon] = $true
        $valor = [string]$Entorno[$k]
        if ($null -eq $valor) { continue }
        try { $psi.EnvironmentVariables[$k] = $valor } catch { }
    }
    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $outTask = $proc.StandardOutput.ReadToEndAsync()
    $errTask = $proc.StandardError.ReadToEndAsync()
    if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
        try { $proc.Kill() } catch { }
        throw 'El comando de reinicio no terminó a tiempo.'
    }
    [void]$proc.WaitForExit()
    return [pscustomobject]@{
        Code = $proc.ExitCode
        Out  = Hide-Clave $outTask.Result
        Err  = Hide-Clave $errTask.Result
    }
}

function Restart-Pm2App([string]$Nombre, $Mapa) {
    $proc = $null
    foreach ($p in @(Get-Pm2Dump)) {
        if ([string]$p.name -eq $Nombre) { $proc = $p }
    }
    if (-not $proc) { throw "PM2 no muestra '$Nombre'. No reinicié." }
    $viejas = Get-Pm2EnvMap $proc
    if (@($viejas.Keys).Count -lt 1) { throw 'PM2 no devolvió el entorno actual. No reinicié para no vaciar n8n.' }
    $envMap = @{}
    $base = Get-BaseEnv
    $pathAdmin = ''
    if ($base.Contains('Path')) { $pathAdmin = [string]$base['Path'] }
    foreach ($k in @($base.Keys)) { $envMap[$k.ToUpperInvariant()] = [string]$base[$k] }
    foreach ($k in @($viejas.Keys)) { $envMap[$k.ToUpperInvariant()] = [string]$viejas[$k] }
    $pathN8n = ''
    if ($viejas.Contains('PATH')) { $pathN8n = [string]$viejas['PATH'] }
    elseif ($viejas.Contains('Path')) { $pathN8n = [string]$viejas['Path'] }
    if ($pathAdmin -and $pathN8n -and $pathN8n -ne $pathAdmin) { $envMap['PATH'] = "$pathN8n;$pathAdmin" }
    foreach ($k in @($Mapa.Keys)) { $envMap[$k.ToUpperInvariant()] = [string]$Mapa[$k] }
    $run = Start-ConEntorno -Exe $env:ComSpec -Argumentos "/d /c pm2 restart `"$Nombre`" --update-env" -Entorno $envMap -TimeoutSec 90
    if ($run.Code -ne 0) { throw "pm2 restart salió $($run.Code). $($run.Err)" }
    Add-Hecho "Reinicié PM2 '$Nombre' conservando $($viejas.Count) variables anteriores."
}

function Restart-N8nDocker($Rt) {
    $dockerCmd = Get-Command docker -ErrorAction Stop
    $probe = Invoke-ToolText -Exe $dockerCmd.Source -Arguments 'compose version' -TimeoutSec 20
    $exe = $dockerCmd.Source
    $prefijo = 'compose'
    if (-not $probe -or $probe.Code -ne 0) {
        $dc = Get-Command docker-compose -ErrorAction SilentlyContinue
        if (-not $dc) { throw 'No encontré docker compose. No recreé el contenedor.' }
        $exe = $dc.Source
        $prefijo = ''
    }
    $paramLinea = @()
    if ($prefijo) { $paramLinea += $prefijo }
    if ($Rt.ComposeDir) { $paramLinea += @('--project-directory', $Rt.ComposeDir) }
    $paramLinea += @('-f', $Rt.ComposeFile, '-f', $OverridePath, 'up', '-d', '--no-deps', '--force-recreate', $Rt.ComposeService)
    $plano = ($paramLinea | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
    $run = Invoke-ToolText -Exe $exe -Arguments $plano -TimeoutSec 180
    if (-not $run -or $run.Code -ne 0) {
        $detalle = ''
        if ($run) { $detalle = Hide-Clave ($run.Err + ' ' + $run.Out) }
        throw "No pude recrear el contenedor. $detalle"
    }
    Add-Hecho "Recreé el contenedor $($Rt.ComposeService) para que tome el entorno."
}

function Restart-N8nHost($Rt, $Mapa) {
    switch ($Rt.Modo) {
        'servicio-nssm' { Restart-Service -Name $Rt.ServiceName -Force; Add-Hecho "Reinicié el servicio $($Rt.ServiceName)." }
        'servicio-winsw' { Restart-Service -Name $Rt.ServiceName -Force; Add-Hecho "Reinicié el servicio $($Rt.ServiceName)." }
        'servicio' { Restart-Service -Name $Rt.ServiceName -Force; Add-Hecho "Reinicié el servicio $($Rt.ServiceName)." }
        'pm2' { Restart-Pm2App -Nombre $Rt.Pm2Name -Mapa $Mapa }
        'tarea' {
            try { Stop-ScheduledTask -TaskName $Rt.TaskName -TaskPath $Rt.TaskPath -ErrorAction Stop } catch { Write-Log 'La tarea no estaba en ejecución.' }
            Start-ScheduledTask -TaskName $Rt.TaskName -TaskPath $Rt.TaskPath
            Add-Hecho "Reinicié la tarea $($Rt.TaskPath)$($Rt.TaskName)."
        }
        'npm' {
            if (-not $Rt.ExecutablePath -or -not $Rt.ProcessId) { throw 'No tengo el ejecutable del proceso n8n. No lo corté.' }
            Stop-Process -Id $Rt.ProcessId -Force
            Start-Sleep -Seconds 2
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = $Rt.ExecutablePath
            $psi.Arguments = $Rt.Arguments
            $psi.UseShellExecute = $false
            $psi.WorkingDirectory = $RobotDir
            [void][System.Diagnostics.Process]::Start($psi)
            Add-Hecho 'Reinicié el proceso node de n8n.'
        }
        'docker' { Restart-N8nDocker $Rt }
        default { throw "No reinicio el modo $($Rt.Modo)." }
    }
}

$csharpTrust = @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class ArcaRobotTrustAll : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) {
        return true;
    }
}
"@
if (-not ('ArcaRobotTrustAll' -as [type])) {
    Add-Type -TypeDefinition $csharpTrust
}

function Test-N8nUrl([string]$Url, [bool]$OmitirCertificado) {
    $previo = $null
    try {
        if ($OmitirCertificado) {
            $previo = [System.Net.ServicePointManager]::CertificatePolicy
            [System.Net.ServicePointManager]::CertificatePolicy = New-Object ArcaRobotTrustAll
        }
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300)
    } catch {
        return $false
    } finally {
        if ($OmitirCertificado) {
            [System.Net.ServicePointManager]::CertificatePolicy = $previo
        }
    }
}

function Wait-N8nHealth([int]$Segundos) {
    $limites = (Get-Date).AddSeconds($Segundos)
    $urls = @(
        @{ Url = 'http://127.0.0.1:5678/healthz'; Skip = $false },
        @{ Url = 'https://127.0.0.1:5678/healthz'; Skip = $true },
        @{ Url = 'https://autbacar.dnsalias.com/healthz'; Skip = $false }
    )
    do {
        foreach ($u in $urls) {
            if (Test-N8nUrl -Url $u.Url -OmitirCertificado $u.Skip) { return $u.Url }
        }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $limites)
    return ''
}

function Add-InstruccionesModo([string]$Detalle) {
    Add-Falta "No pude dejar un solo arranque de n8n ($Detalle). No cambié servicios, PM2, tareas, Docker ni variables."
    Add-Falta 'Cuando haya un solo modo, volvé a correr INSTALAR-ROBOT-ARCA.cmd como administrador.'
    Add-Falta 'A mano, en ESE arranque: ARCA_ENVIOS_URL, ARCA_TXT_DIR=D:\arca-txt, ARCA_SHOTS_DIR=D:\arca-txt\shots, COSP_REPO=D:\APP\cronoapp, ARCA_CLAVES_PATH=D:\secretos\arca-claves.json, ARCA_SIMULACION=1, ARCA_ROBOT_REINTENTOS=3, NODES_EXCLUDE=[], N8N_BLOCK_ENV_ACCESS_IN_NODE=false.'
    Add-Falta 'ARCA_ROBOT_KEY se carga por este instalador (no va en el repo). Después probá http://127.0.0.1:5678/healthz.'
}

function Show-Resumen {
    Write-Host ''
    Write-Host '=== RESUMEN ==='
    Write-Host 'Hecho:'
    if ($script:Hechos.Count -eq 0) { Write-Host '  - (nada)' }
    foreach ($h in $script:Hechos) { Write-Host "  - $h" }
    Write-Host 'Falta:'
    if ($script:Faltan.Count -eq 0) {
        Write-Host '  - Nada. El robot queda en simulación (ARCA_SIMULACION=1).'
    } else {
        foreach ($f in $script:Faltan) { Write-Host "  - $f" }
    }
    if ($script:Notas.Count -gt 0) {
        Write-Host 'A mano:'
        foreach ($n in $script:Notas) { Write-Host "  - $n" }
    }
    Write-Host "Log: $LogPath"
    Write-Log '--- fin ---'
}

if (-not (Test-EsAdmin)) {
    Write-Host 'Ejecutalo con clic derecho sobre INSTALAR-ROBOT-ARCA.cmd y elegí Ejecutar como administrador.'
    exit 1
}

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
New-Item -ItemType Directory -Force -Path $TxtDir, $ShotsDir | Out-Null
Write-Log '--- instalador del robot ARCA ---'
Add-Hecho "Carpetas listas: $TxtDir y $ShotsDir."

$runtime = $null
$mapa = $null
$aplico = $false
try {
    $runtime = Get-N8nRuntime
    if ($runtime.Modo -eq 'desconocido' -and $runtime.Resumen -eq 'no encontré un n8n en marcha') {
        $ocultos = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { Test-TextoN8n $_.CommandLine })
        if ($ocultos.Count -gt 0) {
            $runtime.Resumen = 'hay un proceso node con n8n, pero no pude saber quién lo arrancó (servicio, PM2 o tarea). No lo reinicié.'
        }
    }
    Add-Hecho "Detecté: $($runtime.Resumen)."
    if ($runtime.Modo -eq 'desconocido') {
        Add-InstruccionesModo $runtime.Resumen
    } else {
        $existente = ''
        try { $existente = Get-ExistingRobotKey $runtime } catch { $existente = '' }
        if (Test-ClaveRobotValida $existente) {
            $script:ClaveRobot = $existente
            Add-Hecho 'ARCA_ROBOT_KEY ya estaba en ese arranque. No la volví a pedir.'
        } else {
            try {
                $script:ClaveRobot = Read-ClaveRobot
                Add-Hecho 'ARCA_ROBOT_KEY quedó pedida por pantalla. No está en el repo.'
            } catch {
                $script:ClaveRobot = ''
                Add-Falta $_.Exception.Message
            }
        }
        $mapa = New-ArcaMap $script:ClaveRobot
        try {
            Set-ArcaEnv -Rt $runtime -Mapa $mapa
            $aplico = $true
        } catch {
            Add-Falta (Hide-Clave $_.Exception.Message)
        }
    }
} catch {
    Add-Falta (Hide-Clave $_.Exception.Message)
}

try {
    $cuenta = ''
    if ($runtime) { $cuenta = $runtime.Cuenta }
    Initialize-ArcaSecretos -Cuenta $cuenta
} catch {
    Add-Falta "Secretos: $($_.Exception.Message)"
}

Install-ArcaRobotDeps

if ($aplico) {
    try {
        Restart-N8nHost -Rt $runtime -Mapa $mapa
        $salud = Wait-N8nHealth -Segundos 60
        if ($salud) { Add-Hecho "n8n responde en $salud." }
        else { Add-Falta 'Reinicié n8n pero no respondió GET /healthz (127.0.0.1:5678 ni https://autbacar.dnsalias.com/healthz).' }
    } catch {
        Add-Falta (Hide-Clave $_.Exception.Message)
    }
} else {
    $salud = Wait-N8nHealth -Segundos 8
    if ($salud) { Add-Nota "No reinicié n8n. Igual responde en $salud." }
    else { Add-Nota 'No reinicié n8n y /healthz no respondió.' }
}

Add-Nota 'No seteé N8N_ROBOT_WEBHOOK. Si falta, dejala en el mismo arranque: https://127.0.0.1:5678/webhook/cosp-arca-robot.'
Show-Resumen
if ($script:Faltan.Count -gt 0) { exit 1 }
exit 0
