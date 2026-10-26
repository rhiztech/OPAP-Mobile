# OPAP Mobile - Automated Windows & Mobile Package Builder
# Builds the production web app, standalone launcher, Windows setup wizard, and mobile companion.

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$InstallerSrc = Join-Path $ProjectRoot "installer-src"
$DistInstallers = Join-Path $ProjectRoot "dist-installers"
$DistDir = Join-Path $ProjectRoot "dist"
$CscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   OPAP Mobile - Windows Installer & Companion Builder   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not (Test-Path $DistInstallers)) {
    New-Item -ItemType Directory -Path $DistInstallers | Out-Null
}

# 1. Build React Web Application
Write-Host "`n[1/5] Building production web assets (pnpm build)..." -ForegroundColor Yellow
Set-Location $ProjectRoot
pnpm build
if ($LASTEXITCODE -ne 0) {
    throw "pnpm build failed!"
}

# 2. Assemble Standalone Native Desktop Application (OPAP-Mobile.exe)
Write-Host "`n[2/5] Assembling Standalone Native Windows Application (OPAP-Mobile.exe)..." -ForegroundColor Yellow
$StandaloneDir = Join-Path $DistInstallers "OPAP-Mobile-win32-x64"
$ElectronDist = Join-Path $ProjectRoot "node_modules\electron\dist"

if (-not (Test-Path $ElectronDist)) {
    throw "Electron runtime not found in node_modules\electron\dist. Please run 'pnpm install' or 'pnpm desktop:start' first."
}

if (Test-Path $StandaloneDir) {
    Remove-Item -Recurse -Force $StandaloneDir
}
New-Item -ItemType Directory -Path $StandaloneDir | Out-Null

# Copy Electron binary runtime
Copy-Item -Path "$ElectronDist\*" -Destination $StandaloneDir -Recurse -Force

# Rename electron.exe to OPAP-Mobile.exe
$ElectronExe = Join-Path $StandaloneDir "electron.exe"
$StandaloneExe = Join-Path $StandaloneDir "OPAP-Mobile.exe"
if (Test-Path $ElectronExe) {
    Rename-Item -Path $ElectronExe -NewName "OPAP-Mobile.exe" -Force
}

# Remove default_app.asar
$DefaultAppAsar = Join-Path $StandaloneDir "resources\default_app.asar"
if (Test-Path $DefaultAppAsar) {
    Remove-Item -Force $DefaultAppAsar
}

# Assemble resources/app
$AppDir = Join-Path $StandaloneDir "resources\app"
New-Item -ItemType Directory -Path $AppDir | Out-Null
Copy-Item -Path (Join-Path $ProjectRoot "electron") -Destination $AppDir -Recurse -Force
Copy-Item -Path (Join-Path $ProjectRoot "dist") -Destination $AppDir -Recurse -Force
Copy-Item -Path (Join-Path $ProjectRoot "installer-src") -Destination $AppDir -Recurse -Force

# Production application manifest for standalone runtime
$AppPackageJson = @'
{
  "name": "opap-mobile",
  "version": "1.0.0",
  "main": "electron/main.cjs"
}
'@
[System.IO.File]::WriteAllText((Join-Path $AppDir "package.json"), $AppPackageJson, [System.Text.Encoding]::UTF8)

# Copy Firewall Configurator script into standalone folder and dist-installers
Copy-Item -Path (Join-Path $InstallerSrc "Enable-OPAP-Firewall.bat") -Destination $StandaloneDir -Force
Copy-Item -Path (Join-Path $InstallerSrc "Enable-OPAP-Firewall.bat") -Destination $DistInstallers -Force

# Clean up any leftover log in standalone folder
$OldLog = Join-Path $StandaloneDir "opap_desktop.log"
if (Test-Path $OldLog) { Remove-Item -Force $OldLog }

Write-Host "   -> Successfully created Standalone Desktop App: $StandaloneExe" -ForegroundColor Green

# 3. Compile Windows Uninstaller (Uninstall-OPAP-Mobile.exe)
Write-Host "`n[3/5] Compiling Windows Uninstaller (Uninstall-OPAP-Mobile.exe)..." -ForegroundColor Yellow
$UninstallCs = Join-Path $InstallerSrc "OpapMobileUninstall.cs"
$UninstallExe = Join-Path $StandaloneDir "Uninstall-OPAP-Mobile.exe"
$AppIcon = Join-Path $InstallerSrc "app-icon.ico"
& $CscPath /target:winexe /platform:anycpu /win32icon:"$AppIcon" /out:"$UninstallExe" "$UninstallCs"
if ($LASTEXITCODE -ne 0) {
    throw "Compiling OpapMobileUninstall.cs failed!"
}
Write-Host "   -> Successfully created: $UninstallExe" -ForegroundColor Green

# 3b. Compile Native Screen Wake Utility (WakeScreen.exe)
Write-Host "`n[3b/5] Compiling Native Screen Wake Utility (WakeScreen.exe)..." -ForegroundColor Yellow
$WakeCs = Join-Path $InstallerSrc "WakeScreen.cs"
$WakeExe = Join-Path $StandaloneDir "WakeScreen.exe"
& $CscPath /target:winexe /platform:anycpu /out:"$WakeExe" "$WakeCs"
if ($LASTEXITCODE -ne 0) {
    throw "Compiling WakeScreen.cs failed!"
}
Copy-Item -Path $WakeExe -Destination (Join-Path $InstallerSrc "WakeScreen.exe") -Force
Write-Host "   -> Successfully created: $WakeExe" -ForegroundColor Green

# 4. Package Payload into payload.zip
Write-Host "`n[4/5] Packaging payload into embedded archive (payload.zip)..." -ForegroundColor Yellow
$ReadmeContent = @"
OPAP Mobile - Enterprise LAN Intercom & Push-to-Talk Station
Version: 1.0.0
Publisher: OPAP Systems

OPAP Mobile runs solely inside Windows as a true standalone desktop application.
Zero dependencies on external web browsers (Edge, Chrome, etc.) or extensions.
Port: 8443
Local URL: http://localhost:8443
Android Companion: Pair mobile devices using http://<LAN-IP>:8443
"@
Set-Content -Path (Join-Path $StandaloneDir "README.txt") -Value $ReadmeContent

$PayloadZip = Join-Path $InstallerSrc "payload.zip"
if (Test-Path $PayloadZip) {
    Remove-Item -Force $PayloadZip
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($StandaloneDir, $PayloadZip)
Write-Host "   -> Payload created: $PayloadZip ($((Get-Item $PayloadZip).Length) bytes)" -ForegroundColor Green

# 5. Compile Windows Installation Wizard (OPAP-Mobile-Setup.exe) with embedded payload & UAC Administrator manifest
Write-Host "`n[5/5] Compiling Setup Wizard (OPAP-Mobile-Setup.exe)..." -ForegroundColor Yellow
$SetupCs = Join-Path $InstallerSrc "OpapMobileSetup.cs"
$SetupExe = Join-Path $DistInstallers "OPAP-Mobile-Setup.exe"
$InstallerManifest = Join-Path $InstallerSrc "installer.manifest"

Set-Location $InstallerSrc
& $CscPath /target:winexe /platform:anycpu /win32icon:"$AppIcon" /win32manifest:"$InstallerManifest" /r:System.IO.Compression.FileSystem.dll /resource:payload.zip,payload.zip /out:"$SetupExe" "$SetupCs"
Set-Location $ProjectRoot
if ($LASTEXITCODE -ne 0) {
    throw "Compiling OpapMobileSetup.cs failed!"
}
Write-Host "   -> Successfully created: $SetupExe ($((Get-Item $SetupExe).Length) bytes)" -ForegroundColor Green

# Copy to project root for convenient user access
Copy-Item -Path $SetupExe -Destination (Join-Path $ProjectRoot "OPAP-Mobile-Setup.exe") -Force
Write-Host "   -> Copied installer to project root: $(Join-Path $ProjectRoot "OPAP-Mobile-Setup.exe")" -ForegroundColor Green

# Cleanup temporary payload
Remove-Item -Force $PayloadZip

# 6. Generate Complete Installation & Mobile Pairing Guide
$GuidePath = Join-Path $DistInstallers "INSTALLATION_GUIDE.md"
$GuideContent = @"
# OPAP Mobile - Windows Installation & Mobile Pairing Guide

## Overview
**OPAP Mobile** is an enterprise-grade LAN Intercom and Push-to-Talk (PTT) station with GSM telephony features (Call Waiting, Standby/Hold, Call Swap, and 3-Way Group Conferences).

---

## 1. Windows Installation (Standalone Desktop App)

### Option A: Portable Standalone (No Installation Needed)
Just like VLC or AIMP portable:
1. Open the ``dist-installers\OPAP-Mobile-win32-x64\`` folder.
2. Double-click ``OPAP-Mobile.exe``.
3. The application runs immediately in its own native desktop window. Zero external browsers or dependencies required.

### Option B: Windows Setup Wizard (Recommended)
1. Run ``OPAP-Mobile-Setup.exe`` from the ``dist-installers\`` folder.
2. The **OPAP Mobile Setup Wizard** will guide you through installation:
   - **Destination Directory**: Defaults to ``%LOCALAPPDATA%\Programs\OPAP Mobile`` (per-user installation; requires no administrator privileges).
   - **Shortcuts**: Select **Create Desktop shortcut** and **Create Start Menu shortcut**.
   - **Install**: Copies application binaries, production assets, and registers the uninstaller in Windows.
3. Check **Launch OPAP Mobile** and click **Finish**.

### How OPAP Mobile Runs on Windows
- **100% Self-Contained Desktop Process**: Runs as ``OPAP-Mobile.exe``. Does **NOT** depend on Microsoft Edge, Google Chrome, or any browser installation.
- **Zero Browser UI**: No browser tabs, no URL bar, no browser extensions. It runs in its own native Win32 window with standard window buttons, dark background, and custom taskbar icon.
- **System Tray Management**: Look for the OPAP Mobile icon in the Windows notification tray (near the clock). Right-click to:
  - Open/focus the OPAP Mobile window
  - Copy the Mobile LAN link for Android devices
  - View network and station telemetry
  - Gracefully stop and exit the application

### Uninstallation
- OPAP Mobile is fully registered in Windows:
  - Open **Windows Settings > Apps > Installed Apps** (or Control Panel > Programs and Features).
  - Search for **OPAP Mobile** and click **Uninstall**.
  - Alternatively, launch **Uninstall OPAP Mobile** from the Start Menu group or install folder.

---

## 2. Mobile App Pairing (Android APK)

### Installation on Android
1. Locate ``OPAP-Mobile.apk`` inside ``dist-installers\``.
2. Transfer ``OPAP-Mobile.apk`` to your Android smartphone or tablet (via USB, email, shared drive, or web download).
3. On your Android device, tap the APK file to install it (enable "Install unknown apps" in Android Settings if prompted).

### Pairing Mobile and Windows Over Wi-Fi
1. Ensure both your Windows PC and your Android phone are connected to the **same local Wi-Fi / LAN router**.
2. On Windows, right-click the OPAP Mobile tray icon and select **Copy Mobile LAN Link** (or note the IP displayed in the Setup Wizard / LCD screen, e.g. ``http://192.168.1.X:8443``).
3. Open the **OPAP Mobile** app on Android:
   - Tap **Settings / Network** (or prompt on first run).
   - Enter your Windows station's LAN URL (e.g. ``http://192.168.1.X:8443``).
   - Choose a unique station extension (e.g. EXT 102 - WAREHOUSE).
4. Both devices will immediately discover each other on the 3x3 Keypad:
   - Push-to-Talk (PTT) with zero latency.
   - 1-on-1 and 3-way Group Conference voice calling.
   - GSM Call Waiting, Hold, and Swap.
"@
Set-Content -Path $GuidePath -Value $GuideContent
Write-Host "   -> Created: $GuidePath" -ForegroundColor Green

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "                BUILD COMPLETE SUCCESSFULLY!             " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Artifacts in dist-installers:" -ForegroundColor White
Get-ChildItem -Path $DistInstallers | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
