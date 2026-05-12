@REM Maven Wrapper - permite ejecutar Maven sin tenerlo instalado (mvnw.cmd en vez de mvn)
@echo off
setlocal

if "%JAVA_HOME%"=="" (
  echo ERROR: JAVA_HOME no está definido. Definí la variable JAVA_HOME con la ruta de tu JDK.
  exit /b 1
)
if not exist "%JAVA_HOME%\bin\java.exe" (
  echo ERROR: JAVA_HOME no apunta a un JDK válido: %JAVA_HOME%
  exit /b 1
)

set "MAVEN_PROJECTBASEDIR=%~dp0"
cd /d "%MAVEN_PROJECTBASEDIR%"

set "WRAPPER_JAR=%MAVEN_PROJECTBASEDIR%.mvn\wrapper\maven-wrapper.jar"
set "WRAPPER_PROP=%MAVEN_PROJECTBASEDIR%.mvn\wrapper\maven-wrapper.properties"

if not exist "%WRAPPER_PROP%" (
  echo No se encuentra .mvn\wrapper\maven-wrapper.properties
  exit /b 1
)

if not exist "%WRAPPER_JAR%" (
  echo Descargando Maven Wrapper...
  set "WRAPPER_URL=https://repo.maven.apache.org/maven2/io/takari/maven-wrapper/0.5.6/maven-wrapper-0.5.6.jar"
  powershell -NoProfile -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('%WRAPPER_URL%', '%WRAPPER_JAR%') }"
  if errorlevel 1 (
    echo Fallo la descarga. Proba instalando Maven: winget install Apache.Maven
    exit /b 1
  )
)

"%JAVA_HOME%\bin\java.exe" -classpath "%WRAPPER_JAR%" "-Dmaven.multiModuleProjectDirectory=%MAVEN_PROJECTBASEDIR%" org.apache.maven.wrapper.MavenWrapperMain %*
exit /b %errorlevel%
