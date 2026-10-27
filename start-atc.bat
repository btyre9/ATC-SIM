@echo off
cd /d "%~dp0"
set "url=http://127.0.0.1:8000/index.html"
rem Opens on San Diego, midday bank, clear skies.
set "launch=%url%?sector=KSAN&bank=MIDDAY&wx=CLEAR"
if "%~1"==":open" goto open

curl.exe -fsS --max-time 2 "%url%" 2>nul | findstr /c:"<title>OpenATC Simulator" >nul
if not errorlevel 1 (
    if not "%ATC_NO_OPEN%"=="1" start "" chrome "%launch%"
    echo OpenATC is already running at %url%
    timeout /t 3 >nul
    exit /b 0
)

where python >nul 2>&1
if errorlevel 1 (
    echo Python 3 is required to run the local simulator server.
    pause
    exit /b 1
)

if not "%ATC_NO_OPEN%"=="1" start "" /b cmd /c ""%~f0" :open"
python serve.py 8000
pause
exit /b

:open
rem Waits up to 30 seconds for the server, then opens Chrome.
for /l %%i in (1,1,30) do (
    curl.exe -fsS --max-time 1 "%url%" >nul 2>&1 && (start "" chrome "%launch%" & exit /b 0)
    timeout /t 1 >nul
)
exit /b 1
