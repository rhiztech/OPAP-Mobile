# OPAP Mobile - Windows Installation & Mobile Pairing Guide

## Overview
**OPAP Mobile** is an enterprise-grade LAN Intercom and Push-to-Talk (PTT) station with GSM telephony features (Call Waiting, Standby/Hold, Call Swap, and 3-Way Group Conferences).

---

## 1. Windows Installation (Standalone Desktop App)

### Option A: Portable Standalone (No Installation Needed)
Just like VLC or AIMP portable:
1. Open the `dist-installers\OPAP-Mobile-win32-x64\` folder.
2. Double-click `OPAP-Mobile.exe`.
3. The application runs immediately in its own native desktop window. Zero external browsers or dependencies required.

### Option B: Windows Setup Wizard (Recommended)
1. Run `OPAP-Mobile-Setup.exe` from the `dist-installers\` folder.
2. The **OPAP Mobile Setup Wizard** will guide you through installation:
   - **Destination Directory**: Defaults to `%LOCALAPPDATA%\Programs\OPAP Mobile` (per-user installation; requires no administrator privileges).
   - **Shortcuts**: Select **Create Desktop shortcut** and **Create Start Menu shortcut**.
   - **Install**: Copies application binaries, production assets, and registers the uninstaller in Windows.
3. Check **Launch OPAP Mobile** and click **Finish**.

### How OPAP Mobile Runs on Windows
- **100% Self-Contained Desktop Process**: Runs as `OPAP-Mobile.exe`. Does **NOT** depend on Microsoft Edge, Google Chrome, or any browser installation.
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

## 3. PC-to-PC Intercom Discovery Across Your Local Network

### How Automatic Discovery Works
1. **Physical Wi-Fi / LAN Resolution**: OPAP Mobile automatically isolates physical network adapters from virtual switches (Hyper-V, WSL, VMware, etc.) and binds directly to your router's subnet.
2. **Dual-Channel Auto-Discovery**:
   - **TCP Subnet Sweep**: Automatically probes all local IP addresses on your subnet (`192.168.X.1` to `192.168.X.254`) on port 8443. This bypasses Wi-Fi AP / Multicast isolation completely.
   - **Directed UDP Broadcast**: Broadcasts beacons across physical interfaces on port 8445.
3. **Automatic Station Assignment**:
   - PC 1 defaults to `EXT 100 (Reception / Admin)`.
   - PC 2 automatically resolves collisions and auto-assigns to `EXT 101 (Key 1)` or any free extension.
   - Both PCs immediately appear online in green on each other's 3x3 dialer keypad.

### Troubleshooting PC-to-PC Discovery
- **Windows Defender Firewall**:
  - The installer (`OPAP-Mobile-Setup.exe`) prompts for Administrator permissions to automatically configure Windows Firewall rules for TCP 8443 and UDP 8445 across all network profiles (Domain, Private, Public).
  - If using the portable standalone (`OPAP-Mobile-win32-x64`), simply right-click `Enable-OPAP-Firewall.bat` and select **Run as administrator**.
  - Inside the app, open **Settings (⚙️)** and click **🛡️ ALLOW FIREWALL** to trigger authorization.
- **Manual Subnet Scan**:
  - Open **Settings (⚙️)** and click **🔍 SCAN SUBNET NOW** to force an instant sweep of your local network.
- **Manual IP Connect**:
  - If PCs are connected across different router subnets or isolated guest networks, enter the second PC's IP (e.g. `192.168.100.50`) in **Settings (⚙️) > LAN MESH** and click **CONNECT IP**.
