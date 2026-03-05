@echo off
REM Ejecutar el agente NVR.
setlocal
cd /d "%~dp0"

set "RUN_DIR=run\win64"
if not exist "%RUN_DIR%" goto no_dll

set "JAR=target\nvr-agent-1.0.0.jar"
set "CP=target\lib\*"
if exist "%JAR%" goto run_agent

set "JAR=nvr-agent-1.0.0.jar"
set "CP=lib\*"
if exist "%JAR%" goto run_agent

goto no_jar

:run_agent
set "JAVA_LIBRARY_PATH=%RUN_DIR%"
java -Djava.library.path=%RUN_DIR% -cp "%JAR%;%CP%" com.cronoapp.nvragent.Main %*
goto end

:no_dll
echo No se encuentra la carpeta run\win64 con las DLL del NetSDK.
echo Copia libs\win64 del SDK a run\win64.
goto end

:no_jar
echo No se encuentra nvr-agent-1.0.0.jar en target\ ni en la carpeta actual.
goto end

:end
pause
