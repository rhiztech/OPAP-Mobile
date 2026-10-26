const { app, BrowserWindow, Menu, Tray, session, dialog, clipboard, ipcMain, screen, powerSaveBlocker } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const dgram = require('node:dgram');

const PORT = 8443;
const DISCOVERY_PORT = 8445;
const discoveredPeers = new Map(); // ip -> { lastSeen: number, port: number, isManual?: boolean }
let udpSocket = null;
const APP_WIDTH = 320;
const APP_HEIGHT = 445;
const COLLAPSED_HEIGHT = 240;
const COLLAPSED_WIDTH_IDLE = 24;
const COLLAPSED_WIDTH_HOVER = 85;

let currentAppWidth = APP_WIDTH;
let currentAppHeight = APP_HEIGHT;
let currentPipMode = true;
let currentCollapsed = false;
let currentHovered = false;

let mainWindow = null;
let tray = null;
let httpServer = null;
let isQuitting = false;
const sseClients = new Set();
let latestLocalStation = null;

// Determine base paths
const isDev = !app.isPackaged;
const appRootDir = app.getAppPath();
const distDir = path.join(appRootDir, 'dist');
const iconPath = path.join(appRootDir, 'installer-src', 'app-icon.ico');

function log(msg) {
  try {
    const logPath = path.join(path.dirname(process.execPath), 'opap_desktop.log');
    fs.appendFileSync(logPath, '[' + new Date().toISOString() + '] ' + msg + '\r\n');
  } catch {}
}

let currentPowerSaveId = null;

function wakeDisplayAndPreventSleep() {
  log('Waking display (ON-machine screen light) and focusing station...');
  try {
    if (currentPowerSaveId === null || !powerSaveBlocker.isStarted(currentPowerSaveId)) {
      currentPowerSaveId = powerSaveBlocker.start('prevent-display-sleep');
      log('powerSaveBlocker started: id=' + currentPowerSaveId);
    }
  } catch (err) {
    log('powerSaveBlocker error: ' + err);
  }

  // 1. Run native Win32 wake screen utility (mouse_event + SC_MONITORPOWER + SetThreadExecutionState)
  try {
    const candidates = [
      path.join(appRootDir, 'installer-src', 'WakeScreen.exe'),
      path.join(path.dirname(process.execPath), 'WakeScreen.exe'),
      path.join(appRootDir, 'resources', 'WakeScreen.exe'),
      path.join(appRootDir, 'WakeScreen.exe'),
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (found) {
      require('node:child_process').execFile(found, [], { windowsHide: true }, (err) => {
        if (err) log('WakeScreen.exe error: ' + err.message);
      });
    }
  } catch (err) {
    log('WakeScreen.exe execution error: ' + err);
  }

  // 2. Bring mainWindow to front, unminimize, and restore
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.moveTop();
      mainWindow.focus();
      mainWindow.flashFrame(true);
    } catch (err) {
      log('mainWindow wake focus error: ' + err);
    }
  }
}

function releaseDisplaySleep() {
  try {
    if (currentPowerSaveId !== null && powerSaveBlocker.isStarted(currentPowerSaveId)) {
      powerSaveBlocker.stop(currentPowerSaveId);
      currentPowerSaveId = null;
      log('powerSaveBlocker released.');
    }
  } catch {}
}

process.on('uncaughtException', (err) => {
  log('UNCAUGHT EXCEPTION: ' + (err ? err.stack || err.message : 'unknown'));
});

log('OPAP Mobile starting. execPath: ' + process.execPath + ' appPath: ' + app.getAppPath());

// 1. Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log('Single instance lock failed. Another instance is running.');
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// Helper: IPv4 numeric conversions
function ipToLong(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

function longToIp(long) {
  return [(long >>> 24) & 255, (long >>> 16) & 255, (long >>> 8) & 255, long & 255].join('.');
}

// Helper: Get all active physical network interfaces (prioritizing Wi-Fi / Ethernet, filtering virtual)
function getPhysicalInterfaces() {
  const physicalList = [];
  const fallbackList = [];
  const interfaces = os.networkInterfaces();

  const ignoreKeywords = [
    'loopback', 'virtual', 'vethernet', 'hyper-v', 'vmware', 'wsl',
    'teredo', 'pseudo', 'tailscale', 'zerotier', 'docker', 'vpn', 'npcap'
  ];

  for (const [name, list] of Object.entries(interfaces)) {
    const lowerName = name.toLowerCase();
    const isVirtual = ignoreKeywords.some((kw) => lowerName.includes(kw));

    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) {
        const ip = net.address;
        if (ip.startsWith('127.') || ip.startsWith('169.254.')) continue;

        let broadcast = '255.255.255.255';
        let subnetPrefix = null;
        if (net.netmask) {
          try {
            const ipLong = ipToLong(ip);
            const maskLong = ipToLong(net.netmask);
            const bcastLong = (ipLong | (~maskLong & 0xffffffff)) >>> 0;
            broadcast = longToIp(bcastLong);

            const parts = ip.split('.');
            if (parts.length === 4) {
              subnetPrefix = parts.slice(0, 3).join('.') + '.';
            }
          } catch {}
        }

        const ifaceObj = {
          name,
          address: ip,
          netmask: net.netmask,
          broadcast,
          subnetPrefix,
          isVirtual,
        };

        if (!isVirtual) {
          physicalList.push(ifaceObj);
        } else {
          fallbackList.push(ifaceObj);
        }
      }
    }
  }

  // Sort physical interfaces so Wi-Fi and Ethernet come first
  physicalList.sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    const aPref = aName.includes('wi-fi') || aName.includes('wlan') || aName.includes('ethernet') ? 1 : 0;
    const bPref = bName.includes('wi-fi') || bName.includes('wlan') || bName.includes('ethernet') ? 1 : 0;
    return bPref - aPref;
  });

  return physicalList.length > 0 ? physicalList : fallbackList;
}

// Helper: Get primary physical LAN IP address
function getLanIp() {
  const ifaces = getPhysicalInterfaces();
  if (ifaces.length > 0) {
    return ifaces[0].address;
  }
  return '127.0.0.1';
}

// Helper: Get all local LAN IPv4 addresses across all interfaces
function getAllLanIps() {
  const ips = new Set(['127.0.0.1', 'localhost']);
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4') {
        ips.add(net.address);
      }
    }
  }
  return ips;
}

// Persistent Peer Cache (Stored in AppData)
function getPeerCacheFilePath() {
  try {
    const userData = app.getPath('userData');
    if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
    return path.join(userData, 'opap_discovered_peers.json');
  } catch {
    return path.join(path.dirname(process.execPath), 'opap_discovered_peers.json');
  }
}

function loadPeerCache() {
  try {
    const p = getPeerCacheFilePath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(data)) {
        const myIps = getAllLanIps();
        for (const item of data) {
          if (item && item.ip && !myIps.has(item.ip)) {
            discoveredPeers.set(item.ip, {
              lastSeen: Date.now(),
              port: item.port || PORT,
              isManual: Boolean(item.isManual),
            });
          }
        }
        log('Loaded ' + data.length + ' cached peers from ' + p);
      }
    }
  } catch (err) {
    log('Failed to load peer cache: ' + err.message);
  }
}

function savePeerCache() {
  try {
    const p = getPeerCacheFilePath();
    const list = Array.from(discoveredPeers.entries()).map(([ip, info]) => ({
      ip,
      port: info.port || PORT,
      isManual: Boolean(info.isManual),
    }));
    fs.writeFileSync(p, JSON.stringify(list, null, 2), 'utf8');
  } catch {}
}

// Persistent Station Profile (Stored in AppData)
function getStationProfileFilePath() {
  try {
    const userData = app.getPath('userData');
    if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
    return path.join(userData, 'opap_station_profile.json');
  } catch {
    return path.join(path.dirname(process.execPath), 'opap_station_profile.json');
  }
}

function loadStationProfile() {
  try {
    const p = getStationProfileFilePath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (parsed && parsed.name) {
        latestLocalStation = parsed;
        log('Loaded local station profile from disk: ' + latestLocalStation.name + ' (EXT ' + latestLocalStation.ext + ')');
        return;
      }
    }
  } catch {}

  const host = os.hostname() || 'Station';
  latestLocalStation = {
    id: 'station-' + Date.now().toString(36) + '-' + Math.floor(1000 + Math.random() * 9000),
    name: host,
    full: host + ' Station',
    ext: '101',
    status: 'idle',
    lastSeen: Date.now(),
    isLocal: true,
  };
}

function saveStationProfile(profile) {
  if (!profile) return;
  latestLocalStation = profile;
  try {
    const p = getStationProfileFilePath();
    fs.writeFileSync(p, JSON.stringify(profile, null, 2), 'utf8');
  } catch {}
}

function getLocalStation() {
  if (!latestLocalStation) {
    loadStationProfile();
  }
  return latestLocalStation;
}

// Fast Subnet Probing (Direct TCP HTTP Ping to detect OPAP Stations)
let isScanningSubnet = false;

async function probeSingleIp(ip, port = PORT) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (val) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };
    const options = {
      hostname: ip,
      port: port,
      path: '/api/status',
      method: 'GET',
      timeout: 1200,
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data && (data.app === 'OPAP Mobile Standalone' || (data.app && /OPAP/i.test(data.app)))) {
            return done({ ip, port, valid: true, data });
          }
        } catch {}
        done({ ip, port, valid: false });
      });
    });
    req.on('error', () => done({ ip, port, valid: false }));
    req.on('timeout', () => {
      try { req.destroy(); } catch {}
      done({ ip, port, valid: false });
    });
    req.end();
  });
}

function registerWithRemotePeer(peerIp, peerPort = PORT) {
  try {
    const station = getLocalStation();
    const payload = JSON.stringify({
      senderIp: getLanIp(),
      port: PORT,
      station: station,
      timestamp: Date.now(),
    });
    const req = http.request({
      hostname: peerIp,
      port: peerPort,
      path: '/api/p2p/peer-register',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 3000,
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(b);
          if (data && data.ok) {
            discoveredPeers.set(peerIp, { lastSeen: Date.now(), port: peerPort });
            savePeerCache();
            log('Direct HTTP peer-register succeeded with ' + peerIp + ':' + peerPort);
            if (data.station) {
              const announcePayload = JSON.stringify({
                type: 'peer-announce',
                sender: data.station,
                timestamp: Date.now(),
              });
              sseClients.forEach((client) => {
                try { client.write('data: ' + announcePayload + '\n\n'); } catch { sseClients.delete(client); }
              });
            }
          }
        } catch {}
      });
    });
    req.on('error', () => {});
    req.write(payload);
    req.end();
  } catch {}
}

async function scanLocalSubnet() {
  if (isScanningSubnet) return Array.from(discoveredPeers.keys());
  isScanningSubnet = true;
  const myIps = getAllLanIps();
  const ifaces = getPhysicalInterfaces();
  const targets = new Set();

  for (const iface of ifaces) {
    if (iface.subnetPrefix) {
      for (let i = 1; i <= 254; i++) {
        const targetIp = iface.subnetPrefix + i;
        if (!myIps.has(targetIp)) {
          targets.add(targetIp);
        }
      }
    }
  }

  // Also include previously discovered or cached peers
  for (const peerIp of discoveredPeers.keys()) {
    if (!myIps.has(peerIp)) {
      targets.add(peerIp);
    }
  }

  const targetList = Array.from(targets);
  log('Subnet scan started for ' + targetList.length + ' potential station IPs...');

  const batchSize = 20;
  for (let i = 0; i < targetList.length; i += batchSize) {
    const batch = targetList.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((ip) => probeSingleIp(ip, PORT)));

    for (const res of results) {
      if (res.valid) {
        const isNew = !discoveredPeers.has(res.ip);
        discoveredPeers.set(res.ip, {
          lastSeen: Date.now(),
          port: res.port,
        });
        savePeerCache();

        log('Subnet Scan confirmed OPAP station: ' + res.ip + ':' + res.port + ' (isNew=' + isNew + ')');

        // 1. Direct High-Reliability HTTP Peer Registration
        registerWithRemotePeer(res.ip, res.port);

        // 2. Inject synthetic lan-peer-discovered event into local SSE
        const eventPayload = JSON.stringify({
          type: 'lan-peer-discovered',
          peerIp: res.ip,
          port: res.port,
          timestamp: Date.now(),
        });
        sseClients.forEach((client) => {
          try { client.write('data: ' + eventPayload + '\n\n'); } catch { sseClients.delete(client); }
        });

        // 3. If remote station details were already returned in probe response, emit peer-announce immediately
        if (res.data && res.data.station) {
          const announcePayload = JSON.stringify({
            type: 'peer-announce',
            sender: res.data.station,
            timestamp: Date.now(),
          });
          sseClients.forEach((client) => {
            try { client.write('data: ' + announcePayload + '\n\n'); } catch { sseClients.delete(client); }
          });
        }
      }
    }
  }

  isScanningSubnet = false;
  return Array.from(discoveredPeers.keys());
}

// Automatic LAN UDP Discovery Beacon (Runs on port 8445 with directed broadcast)
function startLanDiscovery() {
  try {
    udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    udpSocket.on('error', (err) => {
      log('UDP discovery socket error: ' + err.message);
    });

    udpSocket.on('message', (msg, rinfo) => {
      try {
        const text = msg.toString('utf8');
        const data = JSON.parse(text);
        if (data.app === 'opap-mobile' && data.type === 'opap-beacon') {
          const peerIp = rinfo.address;
          const myIps = getAllLanIps();
          if (myIps.has(peerIp)) return; // Ignore own beacons

          const peerPort = data.port || PORT;
          const isNew = !discoveredPeers.has(peerIp);
          discoveredPeers.set(peerIp, {
            lastSeen: Date.now(),
            port: peerPort,
          });
          savePeerCache();

          if (isNew) {
            log('New LAN Peer station detected via UDP: ' + peerIp + ':' + peerPort);
            registerWithRemotePeer(peerIp, peerPort);
            const eventPayload = JSON.stringify({
              type: 'lan-peer-discovered',
              peerIp,
              port: peerPort,
              timestamp: Date.now(),
            });
            sseClients.forEach((client) => {
              try { client.write('data: ' + eventPayload + '\n\n'); } catch {}
            });
          }
        }
      } catch {}
    });

    udpSocket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      try {
        udpSocket.setBroadcast(true);
        try {
          udpSocket.addMembership('224.0.0.167');
          log('UDP multicast joined 224.0.0.167');
        } catch (mErr) {
          log('UDP multicast join: ' + mErr.message);
        }
        log('UDP discovery listening on 0.0.0.0:' + DISCOVERY_PORT);
      } catch (err) {
        log('UDP broadcast enable warning: ' + err.message);
      }
    });

    // Beacon broadcast every 2.5 seconds to all interfaces + multicast + 255.255.255.255
    setInterval(() => {
      if (!udpSocket) return;
      const beaconStr = JSON.stringify({
        app: 'opap-mobile',
        type: 'opap-beacon',
        port: PORT,
        timestamp: Date.now(),
      });
      const buf = Buffer.from(beaconStr);

      const physicalIfaces = getPhysicalInterfaces();
      const broadcastAddresses = new Set(['255.255.255.255', '224.0.0.167']);
      for (const p of physicalIfaces) {
        if (p.broadcast && p.broadcast !== '255.255.255.255') {
          broadcastAddresses.add(p.broadcast);
        }
      }

      for (const bcastIp of broadcastAddresses) {
        try {
          udpSocket.send(buf, 0, buf.length, DISCOVERY_PORT, bcastIp, () => {});
        } catch {}
      }

      // Also send direct unicast UDP beacon to all known/cached peer IPs
      for (const peerIp of discoveredPeers.keys()) {
        try {
          udpSocket.send(buf, 0, buf.length, DISCOVERY_PORT, peerIp, () => {});
        } catch {}
      }

      // Clean up stale peers after 25 seconds (unless manually added)
      const now = Date.now();
      for (const [ip, info] of discoveredPeers.entries()) {
        if (!info.isManual && now - info.lastSeen > 25000) {
          log('LAN peer timed out: ' + ip);
          discoveredPeers.delete(ip);
          savePeerCache();
        }
      }
    }, 2500);

  } catch (err) {
    log('startLanDiscovery exception: ' + err.message);
  }
}

// Helper: Forward messages to all discovered LAN peer stations
function forwardToPeers(payloadStr) {
  for (const [peerIp, info] of discoveredPeers.entries()) {
    try {
      const options = {
        hostname: peerIp,
        port: info.port || PORT,
        path: '/api/p2p/peer-broadcast',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadStr),
        },
        timeout: 2000,
      };
      const req = http.request(options, (res) => {
        res.resume();
      });
      req.on('error', () => {});
      req.write(payloadStr);
      req.end();
    } catch {}
  }
}

// 2. Embedded LAN & Signaling Server
function startEmbeddedServer() {
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
  };

  httpServer = http.createServer((req, res) => {
    const rawUrl = req.url || '/';
    const url = rawUrl.split('?')[0];

    // CORS Headers for LAN discovery
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE Event Stream for P2P Discovery
    if (url === '/api/p2p/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': connected\n\n');
      sseClients.add(res);

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    // P2P Broadcast POST (Local client broadcasting to local SSE + all LAN peer stations)
    if (url === '/api/p2p/broadcast' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (body) {
          try {
            const parsed = JSON.parse(body);
            if (parsed && parsed.sender) {
              saveStationProfile(parsed.sender);
            }
          } catch {}
          const sseMsg = body.split('\n').map((l) => 'data: ' + l).join('\n') + '\n\n';
          sseClients.forEach((client) => {
            try { client.write(sseMsg); } catch { sseClients.delete(client); }
          });
          // Forward across the LAN mesh to all discovered peer PCs
          forwardToPeers(body);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, clients: sseClients.size, peers: discoveredPeers.size }));
      });
      return;
    }

    // Direct Peer Registration (High-reliability HTTP handshake)
    if (url === '/api/p2p/peer-register' && req.method === 'POST') {
      let remoteIp = req.socket.remoteAddress || '';
      if (remoteIp.startsWith('::ffff:')) remoteIp = remoteIp.slice(7);
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          let peerIp = remoteIp;
          if (parsed.senderIp && !getAllLanIps().has(parsed.senderIp) && parsed.senderIp !== '127.0.0.1') {
            peerIp = parsed.senderIp;
          } else if (parsed.ip && !getAllLanIps().has(parsed.ip) && parsed.ip !== '127.0.0.1') {
            peerIp = parsed.ip;
          }
          const peerPort = parseInt(parsed.port, 10) || PORT;
          if (peerIp && !getAllLanIps().has(peerIp) && peerIp !== '127.0.0.1') {
            const isNew = !discoveredPeers.has(peerIp);
            discoveredPeers.set(peerIp, { lastSeen: Date.now(), port: peerPort });
            savePeerCache();
            if (isNew) log('Direct HTTP peer-register from: ' + peerIp + ':' + peerPort);
          }
          if (parsed.station) {
            const announcePayload = JSON.stringify({
              type: 'peer-announce',
              sender: parsed.station,
              timestamp: Date.now(),
            });
            sseClients.forEach((client) => {
              try { client.write('data: ' + announcePayload + '\n\n'); } catch { sseClients.delete(client); }
            });
          }
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          app: 'OPAP Mobile Standalone',
          ip: getLanIp(),
          port: PORT,
          station: getLocalStation(),
        }));
      });
      return;
    }

    // P2P Peer Broadcast POST (Received from remote PC - deliver to local SSE only, do not forward)
    if (url === '/api/p2p/peer-broadcast' && req.method === 'POST') {
      let remoteIp = req.socket.remoteAddress || '';
      if (remoteIp.startsWith('::ffff:')) remoteIp = remoteIp.slice(7);
      if (remoteIp && !getAllLanIps().has(remoteIp)) {
        discoveredPeers.set(remoteIp, {
          lastSeen: Date.now(),
          port: PORT,
        });
      }

      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (body) {
          // Parse to check for peer-request-announce and incoming call/page alerts
          let parsed = null;
          try { parsed = JSON.parse(body); } catch {}

          // Auto-wake screen light & system on incoming intercom calls or pager announcements
          if (parsed && (
            parsed.type === 'call-offer' ||
            parsed.type === 'call-ring' ||
            parsed.type === 'call-page' ||
            parsed.type === 'page-start' ||
            parsed.type === 'page-ping' ||
            parsed.type === 'call-waiting'
          )) {
            wakeDisplayAndPreventSleep();
          }

          if (parsed && parsed.type === 'peer-request-announce') {
            const requesterIp = parsed.senderIp || remoteIp;
            const requesterPort = parsed.senderPort || PORT;
            log('peer-request-announce from ' + requesterIp + ' - registering & injecting into local SSE');

            if (requesterIp && !getAllLanIps().has(requesterIp)) {
              discoveredPeers.set(requesterIp, { lastSeen: Date.now(), port: requesterPort });
              savePeerCache();
            }

            const eventPayload = JSON.stringify({
              type: 'lan-peer-discovered',
              peerIp: requesterIp,
              port: requesterPort,
              timestamp: Date.now(),
            });
            sseClients.forEach((client) => {
              try { client.write('data: ' + eventPayload + '\n\n'); } catch {}
            });
          } else {
            // Normal broadcast payload - deliver to local SSE
            const sseMsg = body.split('\n').map((l) => 'data: ' + l).join('\n') + '\n\n';
            sseClients.forEach((client) => {
              try { client.write(sseMsg); } catch { sseClients.delete(client); }
            });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    // Manual Peer Add (Fallback when UDP broadcast is restricted on router)
    if (url === '/api/p2p/add-peer' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const peerIp = (data.ip || '').trim();
          const peerPort = parseInt(data.port, 10) || PORT;
          if (peerIp) {
            discoveredPeers.set(peerIp, {
              lastSeen: Date.now(),
              port: peerPort,
              isManual: true,
            });
            savePeerCache();
            log('Manual LAN peer added: ' + peerIp + ':' + peerPort);
            registerWithRemotePeer(peerIp, peerPort);
          }
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, peers: Array.from(discoveredPeers.keys()) }));
      });
      return;
    }

    // Get active discovered peers
    if (url === '/api/p2p/peers' && req.method === 'GET') {
      const peerList = Array.from(discoveredPeers.entries()).map(([ip, info]) => ({
        ip,
        port: info.port,
        lastSeen: info.lastSeen,
        isManual: Boolean(info.isManual),
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ peers: peerList }));
      return;
    }

    // Status endpoint
    if (url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        app: 'OPAP Mobile Standalone',
        lanIp: getLanIp(),
        port: PORT,
        station: getLocalStation(),
        clients: sseClients.size,
        discoveredPeers: Array.from(discoveredPeers.keys()),
        networkProfile: getNetworkProfile(),
      }));
      return;
    }

    // Subnet Scan trigger endpoint
    if (url === '/api/p2p/scan-subnet') {
      scanLocalSubnet()
        .then((peers) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, peers }));
        })
        .catch((err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        });
      return;
    }

    // Network Profile status endpoint
    if (url === '/api/network-profile') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ profile: getNetworkProfile() }));
      return;
    }

    // Fix Network Profile endpoint (POST)
    if (url === '/api/fix-network-profile' && req.method === 'POST') {
      try {
        const before = getNetworkProfile();
        const ok = forcePrivateNetworkProfile();
        const after = getNetworkProfile();
        log('HTTP fix-network-profile: ' + before + ' -> ' + after);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok, before, after }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    // Network Telemetry Info endpoint
    if (url === '/api/p2p/network-info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        lanIp: getLanIp(),
        port: PORT,
        interfaces: getPhysicalInterfaces(),
        discoveredPeers: Array.from(discoveredPeers.entries()).map(([ip, info]) => ({
          ip,
          port: info.port,
          lastSeen: info.lastSeen,
          isManual: Boolean(info.isManual),
        })),
      }));
      return;
    }

    // Static Asset Serving from dist
    let filePath = path.join(distDir, url === '/' ? 'index.html' : url);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, 'index.html');
    }

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content);
    });
  });

  httpServer.on('error', (err) => {
    log('Embedded HTTP server error: ' + err.message);
  });

  try {
    httpServer.listen(PORT, '0.0.0.0', () => {
      log('Embedded OPAP Station listening on http://0.0.0.0:' + PORT);
    });
  } catch (e) {
    log('Listen exception: ' + e.message);
  }
}

// 3. Create Main Application Window
function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x: workX, y: workY, width: workWidth, height: workHeight } = primaryDisplay.workArea;

  const posX = workX + workWidth - currentAppWidth;
  const posY = workY + Math.max(0, Math.round((workHeight - currentAppHeight) / 2));

  mainWindow = new BrowserWindow({
    width: currentAppWidth,
    height: currentAppHeight,
    x: posX,
    y: posY,
    resizable: true,
    minWidth: 260,
    minHeight: Math.round(260 * (APP_HEIGHT / APP_WIDTH)),
    maxWidth: 640,
    maxHeight: Math.round(640 * (APP_HEIGHT / APP_WIDTH)),
    maximizable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    alwaysOnTop: true,
    title: 'OPAP Mobile - Intercom & PTT Station',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    show: false,
    skipTaskbar: currentPipMode === true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  // Enforce aspect ratio and notify web contents on window resize with recursion protection
  let isAdjustingSize = false;
  mainWindow.on('resize', () => {
    if (!mainWindow || mainWindow.isDestroyed() || currentCollapsed || isAdjustingSize) return;
    isAdjustingSize = true;
    try {
      const [w, h] = mainWindow.getSize();
      const lockedH = Math.round(w * (APP_HEIGHT / APP_WIDTH));
      currentAppWidth = w;
      currentAppHeight = lockedH;
      if (Math.abs(h - lockedH) > 2) {
        mainWindow.setSize(w, lockedH);
      }
      mainWindow.webContents.send('window-size-changed', { width: w, height: lockedH });
    } catch {} finally {
      isAdjustingSize = false;
    }
  });

  // Automatically grant microphone permissions for PTT & Intercom
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      return callback(true);
    }
    callback(true);
  });

  // Load App: Wait for embedded server to be ready, then load.
  // Retries up to 10 times with 300ms intervals to handle server startup delay.
  function tryLoadUrl(retriesLeft) {
    const url = 'http://localhost:' + PORT;
    mainWindow.loadURL(url).catch((err) => {
      log('loadURL attempt failed (' + retriesLeft + ' retries left): ' + (err.message || err));
      if (retriesLeft > 0) {
        setTimeout(() => tryLoadUrl(retriesLeft - 1), 300);
      } else {
        // Final fallback: load dist/index.html directly from file system
        const indexPath = path.join(distDir, 'index.html');
        log('All loadURL retries exhausted. Trying loadFile: ' + indexPath);
        if (fs.existsSync(indexPath)) {
          mainWindow.loadFile(indexPath).catch((fileErr) => {
            log('loadFile also failed: ' + (fileErr.message || fileErr));
          });
        } else {
          log('CRITICAL: dist/index.html not found at ' + indexPath);
          log('appRootDir=' + appRootDir + ' distDir=' + distDir);
          log('Files in appRootDir: ' + (fs.existsSync(appRootDir) ? fs.readdirSync(appRootDir).join(', ') : 'DIR NOT FOUND'));
        }
      }
    });
  }
  tryLoadUrl(10);

  mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
    log('did-fail-load: ' + code + ' ' + desc + ' ' + url);
    // Only retry from file if not already loading from file
    if (url && url.startsWith('http')) {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        log('Falling back to local loadFile: ' + indexPath);
        mainWindow.loadFile(indexPath);
      }
    }
  });

  mainWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
    log('CONSOLE [' + level + ']: ' + message + ' (' + sourceId + ':' + line + ')');
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log('RENDER PROCESS GONE: ' + JSON.stringify(details));
  });

  mainWindow.webContents.on('did-finish-load', () => {
    log('did-finish-load successfully!');
  });

  mainWindow.once('ready-to-show', () => {
    log('mainWindow ready-to-show. Showing window now.');
    mainWindow.show();
  });

  // Notify window blur to trigger auto-hide when clicking outside
  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pip-collapse');
      mainWindow.webContents.send('window-blur');
    }
  });

  mainWindow.on('close', (event) => {
    log('mainWindow close event received. isQuitting=' + isQuitting);
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      log('mainWindow hidden to tray.');
      if (tray) {
        try {
          tray.displayBalloon({
            title: 'OPAP Mobile Running in Tray',
            content: 'OPAP Mobile is active in the background. Double-click tray icon to restore.',
          });
        } catch {}
      }
    }
  });

  mainWindow.on('closed', () => {
    log('mainWindow closed event received.');
    mainWindow = null;
  });
}

// 4. System Tray Integration
function createTray() {
  try {
    if (!fs.existsSync(iconPath)) {
      log('Tray icon not found at: ' + iconPath);
      return;
    }
    tray = new Tray(iconPath);
    log('Tray created successfully.');
    const lanIp = getLanIp();

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'OPAP Mobile (' + lanIp + ':' + PORT + ')',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open OPAP Mobile',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Copy Mobile LAN Link',
      click: () => {
        const link = 'http://' + lanIp + ':' + PORT;
        clipboard.writeText(link);
        dialog.showMessageBox({
          type: 'info',
          title: 'Mobile Link Copied',
          message: 'Mobile LAN Link copied to clipboard:\n' + link + '\n\nEnter this URL in the OPAP Mobile Android companion.',
        });
      },
    },
    {
      label: 'Network & Station Info...',
      click: () => {
        dialog.showMessageBox({
          type: 'info',
          title: 'OPAP Mobile Station Telemetry',
          message: 'Station Name: OPAP Mobile Standalone Station\nLocal IP: ' + lanIp + '\nPort: ' + PORT + '\nStatus: Online & Ready\nClients connected: ' + sseClients.size,
        });
      },
    },
    { type: 'separator' },
    {
      label: 'Exit OPAP Mobile',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('OPAP Mobile - Intercom & PTT Station');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  } catch (err) {
    log('createTray failed: ' + err.message);
  }
}

// 5. IPC Handlers
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});
ipcMain.handle('get-lan-ip', () => getLanIp());
ipcMain.handle('copy-lan-link', () => {
  const link = 'http://' + getLanIp() + ':' + PORT;
  clipboard.writeText(link);
  return link;
});
ipcMain.handle('toggle-always-on-top', () => {
  if (mainWindow) {
    const next = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(next);
    return next;
  }
  return false;
});
ipcMain.handle('set-pip-state', (event, { pipMode, collapsed, hovered }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (typeof pipMode === 'boolean') currentPipMode = pipMode;
  if (typeof collapsed === 'boolean') currentCollapsed = collapsed;
  if (typeof hovered === 'boolean') currentHovered = hovered;

  // Requirement 2: Do not show app icon on task bar when in PiP mode
  try {
    mainWindow.setSkipTaskbar(currentPipMode === true);
  } catch {}

  const primaryDisplay = screen.getPrimaryDisplay();
  const { x: workX, y: workY, width: workWidth, height: workHeight } = primaryDisplay.workArea;

  isAdjustingSize = true;
  try {
    if (currentPipMode === false) {
      // Screen center mode (Floating window)
      mainWindow.setMinimumSize(260, Math.round(260 * (APP_HEIGHT / APP_WIDTH)));
      mainWindow.setMaximumSize(640, Math.round(640 * (APP_HEIGHT / APP_WIDTH)));
      const posX = workX + Math.max(0, Math.round((workWidth - currentAppWidth) / 2));
      const posY = workY + Math.max(0, Math.round((workHeight - currentAppHeight) / 2));
      mainWindow.setBounds({ x: posX, y: posY, width: currentAppWidth, height: currentAppHeight });
      return;
    }

    // PiP Mode (Attached to right screen bezel)
    if (currentCollapsed) {
      // Temporarily remove min/max size restrictions so Win32 permits narrow strip
      mainWindow.setMinimumSize(1, 1);
      mainWindow.setMaximumSize(10000, 10000);
      const width = currentHovered ? COLLAPSED_WIDTH_HOVER : COLLAPSED_WIDTH_IDLE;
      const height = COLLAPSED_HEIGHT;
      const posX = workX + workWidth - width;
      const posY = workY + Math.max(0, Math.round((workHeight - height) / 2));
      mainWindow.setBounds({ x: posX, y: posY, width: width, height: height });
    } else {
      mainWindow.setMinimumSize(260, Math.round(260 * (APP_HEIGHT / APP_WIDTH)));
      mainWindow.setMaximumSize(640, Math.round(640 * (APP_HEIGHT / APP_WIDTH)));
      const posX = workX + workWidth - currentAppWidth;
      const posY = workY + Math.max(0, Math.round((workHeight - currentAppHeight) / 2));
      mainWindow.setBounds({ x: posX, y: posY, width: currentAppWidth, height: currentAppHeight });
    }
  } catch (err) {
    log('set-pip-state error: ' + (err ? err.message : err));
  } finally {
    isAdjustingSize = false;
  }
});

ipcMain.handle('wake-display', () => {
  wakeDisplayAndPreventSleep();
  return true;
});

ipcMain.handle('release-display', () => {
  releaseDisplaySleep();
  return true;
});

ipcMain.handle('save-station-profile', (event, profile) => {
  saveStationProfile(profile);
  return true;
});

ipcMain.handle('get-station-profile', () => {
  return getLocalStation();
});

ipcMain.handle('set-window-size', (event, { width, height }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const w = Math.max(260, Math.min(640, Math.round(width)));
  const h = Math.round(w * (APP_HEIGHT / APP_WIDTH));
  currentAppWidth = w;
  currentAppHeight = h;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { x: workX, y: workY, width: workWidth, height: workHeight } = primaryDisplay.workArea;

  isAdjustingSize = true;
  try {
    if (currentPipMode === false) {
      const posX = workX + Math.max(0, Math.round((workWidth - currentAppWidth) / 2));
      const posY = workY + Math.max(0, Math.round((workHeight - currentAppHeight) / 2));
      mainWindow.setBounds({ x: posX, y: posY, width: currentAppWidth, height: currentAppHeight });
    } else if (!currentCollapsed) {
      const posX = workX + workWidth - currentAppWidth;
      const posY = workY + Math.max(0, Math.round((workHeight - currentAppHeight) / 2));
      mainWindow.setBounds({ x: posX, y: posY, width: currentAppWidth, height: currentAppHeight });
    }
  } catch (err) {
    log('set-window-size error: ' + (err ? err.message : err));
  } finally {
    isAdjustingSize = false;
  }
});

ipcMain.handle('get-peers', () => {
  return Array.from(discoveredPeers.entries()).map(([ip, info]) => ({
    ip,
    port: info.port,
    lastSeen: info.lastSeen,
    isManual: Boolean(info.isManual),
  }));
});

ipcMain.handle('add-peer', (event, { ip, port }) => {
  const cleanIp = (ip || '').trim();
  const cleanPort = parseInt(port, 10) || PORT;
  if (cleanIp) {
    discoveredPeers.set(cleanIp, {
      lastSeen: Date.now(),
      port: cleanPort,
      isManual: true,
    });
    savePeerCache();
    log('IPC add-peer registered: ' + cleanIp + ':' + cleanPort);
    return { ok: true, peers: Array.from(discoveredPeers.keys()) };
  }
  return { ok: false, error: 'Invalid IP address' };
});

ipcMain.handle('scan-network-subnet', async () => {
  try {
    const peers = await scanLocalSubnet();
    return { ok: true, peers };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-station-network-info', () => {
  const ifaces = getPhysicalInterfaces();
  return {
    lanIp: getLanIp(),
    port: PORT,
    interfaces: ifaces,
    discoveredPeers: Array.from(discoveredPeers.entries()).map(([ip, info]) => ({
      ip,
      port: info.port,
      lastSeen: info.lastSeen,
      isManual: Boolean(info.isManual),
    })),
  };
});

ipcMain.handle('get-network-profile', () => {
  return getNetworkProfile();
});

ipcMain.handle('fix-network-profile', async () => {
  try {
    const before = getNetworkProfile();
    log('fix-network-profile: current profile = ' + before);
    const ok = forcePrivateNetworkProfile();
    const after = getNetworkProfile();
    log('fix-network-profile: new profile = ' + after + ' ok=' + ok);
    return { ok, before, after };
  } catch (e) {
    log('fix-network-profile error: ' + e.message);
    return { ok: false, error: e.message };
  }
});

function areFirewallRulesActive() {
  const { execSync } = require('child_process');
  try {
    const out = execSync('netsh advfirewall firewall show rule name="OPAP Mobile Intercom (TCP 8443)"', {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    });
    return out.includes('Enabled:') && (out.includes('Yes') || out.includes('yes'));
  } catch {
    return false;
  }
}

function getNetworkProfile() {
  const { execSync } = require('child_process');
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-NetConnectionProfile | Select-Object -ExpandProperty NetworkCategory"',
      { encoding: 'utf8', timeout: 3000, windowsHide: true }
    );
    const text = out.trim().toLowerCase();
    if (text.includes('public')) return 'Public';
    if (text.includes('private')) return 'Private';
    if (text.includes('domain')) return 'DomainAuthenticated';
    return 'Unknown';
  } catch {
    return 'Unknown';
  }
}

function forcePrivateNetworkProfile() {
  const { execSync } = require('child_process');
  // Method 1: PowerShell Set-NetConnectionProfile (requires elevation on Public, but try non-elevated first)
  try {
    execSync(
      'powershell -NoProfile -Command "Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -ne \'DomainAuthenticated\' } | Set-NetConnectionProfile -NetworkCategory Private"',
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    );
    log('Network profile set to Private via PowerShell (non-elevated).');
    return true;
  } catch (e1) {
    log('forcePrivateNetworkProfile non-elevated failed: ' + e1.message);
  }
  // Method 2: Registry-based approach (works without elevation on many Windows configs)
  try {
    // Find the network profile GUID and set it to Private (category 1) via registry
    execSync(
      'powershell -NoProfile -Command "' +
      '$profiles = Get-ChildItem -Path HKLM:\\\\SOFTWARE\\\\Microsoft\\\\Windows NT\\\\CurrentVersion\\\\NetworkList\\\\Profiles;' +
      'foreach ($p in $profiles) {' +
      '  $cat = (Get-ItemProperty -Path $p.PSPath -Name Category).Category;' +
      '  if ($cat -eq 0) { Set-ItemProperty -Path $p.PSPath -Name Category -Value 1 }' +
      '}"',
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    );
    log('Network profile set to Private via registry fallback.');
    return true;
  } catch (e2) {
    log('forcePrivateNetworkProfile registry fallback failed: ' + e2.message);
  }
  return false;
}

ipcMain.handle('authorize-firewall', async () => {
  const { exec } = require('child_process');
  const exePath = process.execPath;

  const batLines = [
    '@echo off',
    'netsh advfirewall firewall delete rule name="OPAP Mobile Application" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="OPAP Mobile Standalone Application" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="OPAP Mobile Intercom (TCP 8443)" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="OPAP Mobile Discovery (UDP 8445)" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="OPAP Mobile TCP Out" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="OPAP Mobile UDP Out" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="OPAP Mobile ICMP In" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="OPAP Mobile ICMP Out" >nul 2>&1',
    'powershell -NoProfile -Command "Get-NetFirewallRule | Where-Object { ($_.DisplayName -like \'*OPAP*\' -or $_.Name -like \'*OPAP*\') -and $_.Action -eq \'Block\' } | Remove-NetFirewallRule" >nul 2>&1',
    'netsh advfirewall firewall add rule name="OPAP Mobile Application" dir=in action=allow program="' + exePath.replace(/\//g, '\\') + '" enable=yes profile=any',
    'netsh advfirewall firewall add rule name="OPAP Mobile Intercom (TCP 8443)" dir=in action=allow protocol=TCP localport=8443 profile=any',
    'netsh advfirewall firewall add rule name="OPAP Mobile Discovery (UDP 8445)" dir=in action=allow protocol=UDP localport=8445 profile=any',
    'netsh advfirewall firewall add rule name="OPAP Mobile TCP Out" dir=out action=allow protocol=TCP remoteport=8443 profile=any',
    'netsh advfirewall firewall add rule name="OPAP Mobile UDP Out" dir=out action=allow protocol=UDP remoteport=8445 profile=any',
    'netsh advfirewall firewall add rule name="OPAP Mobile ICMP In" dir=in action=allow protocol=ICMPv4 profile=any',
    'netsh advfirewall firewall add rule name="OPAP Mobile ICMP Out" dir=out action=allow protocol=ICMPv4 profile=any',
    'netsh advfirewall firewall set rule group="Network Discovery" new enable=yes profile=any >nul 2>&1',
    'netsh advfirewall firewall set rule group="File and Printer Sharing" new enable=yes profile=any >nul 2>&1',
    'sc config fdPHost start= auto >nul 2>&1',
    'net start fdPHost >nul 2>&1',
    'sc config FDResPub start= auto >nul 2>&1',
    'net start FDResPub >nul 2>&1',
    'powershell -NoProfile -Command "Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -ne \'DomainAuthenticated\' } | Set-NetConnectionProfile -NetworkCategory Private" >nul 2>&1',
    '',
  ];

  try {
    const tmpDir = app.getPath('temp') || os.tmpdir();
    const batPath = path.join(tmpDir, 'opap_firewall_setup.bat');
    fs.writeFileSync(batPath, batLines.join('\r\n'), 'utf8');

    return new Promise((resolve) => {
      const psCmd = 'Start-Process -FilePath "' + batPath.replace(/\\/g, '\\\\') + '" -Verb RunAs -WindowStyle Hidden -Wait';
      exec('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "' + psCmd + '"', { timeout: 30000, windowsHide: true }, (err) => {
        if (err) {
          log('authorize-firewall error: ' + err.message);
          resolve({ ok: false, error: err.message });
        } else {
          log('authorize-firewall: All rules configured with elevation.');
          resolve({ ok: true });
        }
      });
    });
  } catch (e) {
    log('authorize-firewall exception: ' + e.message);
    return { ok: false, error: e.message };
  }
});

// App Lifecycle
function setupFirewallSilently() {
  const { exec } = require('child_process');
  const exePath = process.execPath;

  // ALWAYS try to set Private network profile (non-blocking, best-effort)
  try {
    forcePrivateNetworkProfile();
  } catch {}

  // Check if rules are already verified
  if (areFirewallRulesActive()) {
    log('Firewall rules already active and verified.');
    return;
  }

  log('Firewall rules not verified active. Preparing setup...');

  const batLines = [
    '@echo off',
    ':: OPAP Mobile auto-firewall setup',
    'netsh advfirewall firewall delete rule name="OPAP Mobile Application" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="OPAP Mobile Standalone Application" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="OPAP Mobile Intercom (TCP 8443)" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="OPAP Mobile Discovery (UDP 8445)" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="OPAP Mobile TCP Out" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="OPAP Mobile UDP Out" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="OPAP Mobile ICMP In" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="OPAP Mobile ICMP Out" >nul 2>&1',
    'powershell -NoProfile -Command "Get-NetFirewallRule | Where-Object { ($_.DisplayName -like \'*OPAP*\' -or $_.Name -like \'*OPAP*\') -and $_.Action -eq \'Block\' } | Remove-NetFirewallRule" >nul 2>&1',
    'netsh advfirewall firewall add rule name="OPAP Mobile Application" dir=in action=allow program="' + exePath.replace(/\//g, '\\') + '" enable=yes profile=any',
    'netsh advfirewall firewall add rule name="OPAP Mobile Intercom (TCP 8443)" dir=in action=allow protocol=TCP localport=8443 profile=any',
    'netsh advfirewall firewall add rule name="OPAP Mobile Discovery (UDP 8445)" dir=in action=allow protocol=UDP localport=8445 profile=any',
    'netsh advfirewall firewall add rule name="OPAP Mobile TCP Out" dir=out action=allow protocol=TCP remoteport=8443 profile=any',
    'netsh advfirewall firewall add rule name="OPAP Mobile UDP Out" dir=out action=allow protocol=UDP remoteport=8445 profile=any',
    'netsh advfirewall firewall add rule name="OPAP Mobile ICMP In" dir=in action=allow protocol=ICMPv4 profile=any',
    'netsh advfirewall firewall add rule name="OPAP Mobile ICMP Out" dir=out action=allow protocol=ICMPv4 profile=any',
    'netsh advfirewall firewall set rule group="Network Discovery" new enable=yes profile=any >nul 2>&1',
    'netsh advfirewall firewall set rule group="File and Printer Sharing" new enable=yes profile=any >nul 2>&1',
    'sc config fdPHost start= auto >nul 2>&1',
    'net start fdPHost >nul 2>&1',
    'sc config FDResPub start= auto >nul 2>&1',
    'net start FDResPub >nul 2>&1',
    'powershell -NoProfile -Command "Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -ne \'DomainAuthenticated\' } | Set-NetConnectionProfile -NetworkCategory Private" >nul 2>&1',
    '',
  ];

  let batPath;
  try {
    const tmpDir = app.getPath('temp') || os.tmpdir();
    batPath = path.join(tmpDir, 'opap_firewall_setup.bat');
    fs.writeFileSync(batPath, batLines.join('\r\n'), 'utf8');
  } catch (e) {
    log('Failed to write firewall batch: ' + e.message);
    return;
  }

  // Request UAC elevation to ensure rules and Private profile are applied
  const psCmd = 'Start-Process -FilePath "' + batPath.replace(/\\/g, '\\\\') + '" -Verb RunAs -WindowStyle Hidden -Wait';
  exec('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "' + psCmd + '"', { timeout: 30000, windowsHide: true }, (err) => {
    if (err) {
      log('UAC firewall setup note: ' + err.message);
    } else {
      log('Firewall rules & Private network profile configured via elevation.');
    }
  });
}

app.whenReady().then(() => {
  log('app.whenReady resolved. Starting server, UDP discovery, window, tray.');
  loadPeerCache();
  startEmbeddedServer();
  startLanDiscovery();

  // Attempt silent firewall rule setup
  setupFirewallSilently();

  // Initial immediate subnet scan after 1.5 seconds (gives server time to start)
  setTimeout(() => {
    scanLocalSubnet().catch(() => {});
  }, 1500);

  // Periodic background subnet sweep every 12 seconds
  setInterval(() => {
    scanLocalSubnet().catch(() => {});
  }, 12000);

  // Every 4 seconds, refresh lastSeen on all known peers and nudge them if they haven't responded
  setInterval(() => {
    const myIps = getAllLanIps();
    const now = Date.now();
    for (const [peerIp, info] of discoveredPeers.entries()) {
      if (myIps.has(peerIp)) continue;
      // If peer hasn't been seen in over 8 seconds, probe it directly
      if (now - info.lastSeen > 8000) {
        probeSingleIp(peerIp, info.port || PORT).then((res) => {
          if (res.valid) {
            discoveredPeers.set(peerIp, { lastSeen: Date.now(), port: res.port, isManual: info.isManual });
            savePeerCache();
          } else {
            log('Peer keepalive failed: ' + peerIp + ' - will retry on next scan');
          }
        }).catch(() => {});
      }
    }

    // Also inject lan-peer-discovered for all active peers every 4 seconds to keep React UI in sync
    for (const [peerIp, info] of discoveredPeers.entries()) {
      if (myIps.has(peerIp)) continue;
      if (now - info.lastSeen < 30000) {
        const eventPayload = JSON.stringify({
          type: 'lan-peer-discovered',
          peerIp,
          port: info.port || PORT,
          timestamp: Date.now(),
        });
        sseClients.forEach((client) => {
          try { client.write('data: ' + eventPayload + '\n\n'); } catch {}
        });
      }
    }
  }, 4000);

  createWindow();
  createTray();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  log('app before-quit event received.');
  isQuitting = true;
  if (httpServer) {
    try { httpServer.close(); } catch {}
  }
  if (udpSocket) {
    try { udpSocket.close(); } catch {}
  }
});

app.on('will-quit', () => {
  log('app will-quit event received.');
});

app.on('window-all-closed', () => {
  log('app window-all-closed event received.');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
