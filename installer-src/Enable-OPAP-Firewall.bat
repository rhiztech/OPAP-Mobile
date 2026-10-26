@echo off
:: OPAP Mobile - Full Network Discovery & Firewall Authorization Script
:: Run this file as Administrator to open all required ports and enable LAN Intercom discovery.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] Requesting Administrator Privileges...
    powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

echo ========================================================
echo   OPAP Mobile - Network Discovery ^& Firewall Setup
echo ========================================================
echo.

echo [1/9] Removing old OPAP firewall rules...
netsh advfirewall firewall delete rule name="OPAP Mobile Intercom (TCP 8443)" >nul 2>&1
netsh advfirewall firewall delete rule name="OPAP Mobile Discovery (UDP 8445)" >nul 2>&1
netsh advfirewall firewall delete rule name="OPAP Mobile Application" >nul 2>&1
netsh advfirewall firewall delete rule name="OPAP Mobile Standalone Application" >nul 2>&1
netsh advfirewall firewall delete rule name="OPAP Mobile TCP Out" >nul 2>&1
netsh advfirewall firewall delete rule name="OPAP Mobile UDP Out" >nul 2>&1
netsh advfirewall firewall delete rule name="OPAP Mobile ICMP In" >nul 2>&1
netsh advfirewall firewall delete rule name="OPAP Mobile ICMP Out" >nul 2>&1
echo    Done.

echo [2/9] Adding Inbound TCP Port 8443 (HTTP + P2P Signaling)...
netsh advfirewall firewall add rule name="OPAP Mobile Intercom (TCP 8443)" dir=in action=allow protocol=TCP localport=8443 profile=any

echo [3/9] Adding Inbound UDP Port 8445 (Peer Discovery Beacons)...
netsh advfirewall firewall add rule name="OPAP Mobile Discovery (UDP 8445)" dir=in action=allow protocol=UDP localport=8445 profile=any

echo [4/9] Adding Outbound TCP Port 8443 (connect to peer stations)...
netsh advfirewall firewall add rule name="OPAP Mobile TCP Out" dir=out action=allow protocol=TCP remoteport=8443 profile=any

echo [5/9] Adding Outbound UDP Port 8445 (broadcast discovery)...
netsh advfirewall firewall add rule name="OPAP Mobile UDP Out" dir=out action=allow protocol=UDP remoteport=8445 profile=any

echo [6/9] Adding ICMP Echo (Ping) rules...
netsh advfirewall firewall add rule name="OPAP Mobile ICMP In" dir=in action=allow protocol=ICMPv4 profile=any
netsh advfirewall firewall add rule name="OPAP Mobile ICMP Out" dir=out action=allow protocol=ICMPv4 profile=any

echo [7/9] Adding Application Inbound Rules...
set "APP_DIR=%~dp0"
if exist "%APP_DIR%OPAP-Mobile.exe" (
    netsh advfirewall firewall add rule name="OPAP Mobile Application" dir=in action=allow program="%APP_DIR%OPAP-Mobile.exe" enable=yes profile=any
    echo    Added rule for: %APP_DIR%OPAP-Mobile.exe
)
if exist "%APP_DIR%OPAP-Mobile-win32-x64\OPAP-Mobile.exe" (
    netsh advfirewall firewall add rule name="OPAP Mobile Standalone Application" dir=in action=allow program="%APP_DIR%OPAP-Mobile-win32-x64\OPAP-Mobile.exe" enable=yes profile=any
    echo    Added rule for: %APP_DIR%OPAP-Mobile-win32-x64\OPAP-Mobile.exe
)
:: Check common install paths
if exist "%LOCALAPPDATA%\Programs\OPAP Mobile\OPAP-Mobile.exe" (
    netsh advfirewall firewall add rule name="OPAP Mobile Application" dir=in action=allow program="%LOCALAPPDATA%\Programs\OPAP Mobile\OPAP-Mobile.exe" enable=yes profile=any
    echo    Added rule for: %LOCALAPPDATA%\Programs\OPAP Mobile\OPAP-Mobile.exe
)
if exist "%LOCALAPPDATA%\OPAP Mobile\OPAP-Mobile.exe" (
    netsh advfirewall firewall add rule name="OPAP Mobile Application" dir=in action=allow program="%LOCALAPPDATA%\OPAP Mobile\OPAP-Mobile.exe" enable=yes profile=any
    echo    Added rule for: %LOCALAPPDATA%\OPAP Mobile\OPAP-Mobile.exe
)
if exist "%ProgramFiles%\OPAP Mobile\OPAP-Mobile.exe" (
    netsh advfirewall firewall add rule name="OPAP Mobile Application" dir=in action=allow program="%ProgramFiles%\OPAP Mobile\OPAP-Mobile.exe" enable=yes profile=any
    echo    Added rule for: %ProgramFiles%\OPAP Mobile\OPAP-Mobile.exe
)

echo [8/9] Enabling Windows Network Discovery...
netsh advfirewall firewall set rule group="Network Discovery" new enable=yes profile=private >nul 2>&1
netsh advfirewall firewall set rule group="Network Discovery" new enable=yes profile=public >nul 2>&1
:: Enable File and Printer Sharing echo (ping)
netsh advfirewall firewall set rule name="File and Printer Sharing (Echo Request - ICMPv4-In)" new enable=yes profile=private >nul 2>&1
netsh advfirewall firewall set rule name="File and Printer Sharing (Echo Request - ICMPv4-In)" new enable=yes profile=public >nul 2>&1
echo    Done.

echo [9/9] Setting network profile to Private (enables discovery)...
powershell -NoProfile -Command "Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -ne 'DomainAuthenticated' } | Set-NetConnectionProfile -NetworkCategory Private" >nul 2>&1
echo    Done.

echo.
echo ========================================================
echo   SUCCESS: All OPAP Network ^& Firewall rules applied!
echo ========================================================
echo.
echo   Ports opened:
echo     - TCP 8443 (In+Out) : HTTP server + P2P signaling
echo     - UDP 8445 (In+Out) : LAN peer discovery beacons
echo     - ICMP     (In+Out) : Ping for network detection
echo   Network Discovery : Enabled (Private + Public)
echo   Network Profile   : Private
echo.
echo   Both PCs must run this script for mutual discovery.
echo.
pause
