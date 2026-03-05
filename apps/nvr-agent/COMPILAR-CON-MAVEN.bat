@echo off
REM Compilar el agente usando Maven portable (no hace falta tener mvn en el PATH).
REM 1) Descarga Maven: https://maven.apache.org/download.cgi  (apache-maven-3.9.x-bin.zip)
REM 2) Descomprime en D:\APP\maven  (debe quedar D:\APP\maven\bin\mvn.cmd)
REM 3) Ejecuta este script.

setlocal
cd /d "%~dp0"

REM --- Maven: ruta donde esta instalado ---
set "MAVEN_HOME=D:\APP\maven"
REM --- SDK: si existe sdk\pom.xml dentro de nvr-agent, se usa esa carpeta; si no, la ruta externa ---
set "SDK_PATH=%~dp0sdk"
if not exist "%SDK_PATH%\pom.xml" set "SDK_PATH=D:\APP\General_NetSDK_ChnEng_JAVA_Win64_IS_V3.060.0000003.0.R.251127"
REM Para forzar ruta externa: comenta las 2 lineas de arriba y pon set "SDK_PATH=D:\ruta\al\SDK\..."

set "MVN=%MAVEN_HOME%\bin\mvn.cmd"
if not exist "%MVN%" goto no_maven
if not exist "%SDK_PATH%\pom.xml" goto no_sdk
goto ok_checks
:no_maven
echo.
echo  Maven no esta en: %MAVEN_HOME%
echo.
echo  1. Entra a: https://maven.apache.org/download.cgi
echo  2. Descarga "apache-maven-3.9.x-bin.zip"
echo  3. Descomprime el ZIP en D:\APP\maven
echo  4. Vuelve a ejecutar este script.
echo.
pause
exit /b 1
:no_sdk
echo.
echo  No se encuentra el SDK.
echo  Opcion 1: Copia la carpeta del NetSDK (la que tiene pom.xml y libs\win64) dentro de nvr-agent como "sdk".
echo  Opcion 2: Edita COMPILAR-CON-MAVEN.bat y configura SDK_PATH con la ruta del SDK.
echo.
pause
exit /b 1
:ok_checks

set "PATH=%MAVEN_HOME%\bin;%PATH%"

echo [0/4] Corrigiendo pom.xml del SDK (goal assembly -^> single)...
powershell -NoProfile -Command "(Get-Content -LiteralPath '%SDK_PATH%\pom.xml' -Raw) -replace '<goal>assembly</goal>', '<goal>single</goal>' | Set-Content -LiteralPath '%SDK_PATH%\pom.xml' -NoNewline"
if errorlevel 1 echo  (Si falla, edita el pom.xml del SDK a mano: cambia assembly por single.)

echo [1/4] Instalando NetSDK en Maven...
cd /d "%SDK_PATH%"
call mvn clean install -DskipTests
if errorlevel 1 (
    echo Error al instalar el SDK.
    pause
    exit /b 1
)

echo.
echo [2/4] Compilando el agente...
cd /d "%~dp0"
call mvn clean package
if errorlevel 1 (
    echo Error al compilar.
    pause
    exit /b 1
)

echo.
echo [3/4] Copiando DLL del SDK a run\win64...
if not exist "run\win64" mkdir "run\win64"
xcopy "%SDK_PATH%\libs\win64\*.*" "run\win64\" /Y /Q

echo.
echo Listo. Para ejecutar el agente usa: run.bat
pause
