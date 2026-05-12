@echo off
REM Compilar el agente NVR con Maven (usa D:\APP\maven si mvn no está en el PATH)
setlocal
cd /d "%~dp0"

set "MAVEN_HOME=D:\APP\maven"
set "MVN=%MAVEN_HOME%\bin\mvn.cmd"
if not exist "%MVN%" (
  set "MVN=%MAVEN_HOME%\bin\mvn.bat"
)
if not exist "%MVN%" (
  echo No se encuentra Maven en %MAVEN_HOME%\bin
  echo Proba con: mvnw.cmd clean package -DskipTests
  pause
  exit /b 1
)

echo Compilando con Maven...
"%MVN%" clean package -DskipTests
pause
