import React, { useState, useEffect } from 'react'
import { Peer, Status, NetworkStats } from '../types/opap'
import { sound } from '../services/soundSynthesizer'
import { p2pNetwork } from '../services/p2pNetwork'

interface NetworkSettingsModalProps {
  myProfile: Peer
  stats: NetworkStats
  occupiedExts?: string[]
  systemSettings: SystemSettings
  isSimulatedEnabled: boolean
  isSoundMuted: boolean
  onUpdateProfile: (updates: Partial<Pick<Peer, 'name' | 'full' | 'ext' | 'status'>>) => void
  onUpdateSystemSettings: (settings: SystemSettings) => void
  onToggleSimulated: (enabled: boolean) => void
  onToggleMute: (muted: boolean) => void
  onResetRegistration?: () => void
  onClose: () => void
}

const EXT_OPTIONS = [
  { ext: '100', label: '100 (Master / Admin / Reception)' },
  { ext: '101', label: '101 (Dialer Key 1)' },
  { ext: '102', label: '102 (Dialer Key 2)' },
  { ext: '103', label: '103 (Dialer Key 3)' },
  { ext: '104', label: '104 (Dialer Key 4)' },
  { ext: '105', label: '105 (Dialer Key 5)' },
  { ext: '106', label: '106 (Dialer Key 6)' },
  { ext: '107', label: '107 (Dialer Key 7)' },
  { ext: '108', label: '108 (Dialer Key 8)' },
  { ext: '109', label: '109 (Dialer Key 9)' },
]

const STATUS_CYCLE: Status[] = ['idle', 'busy', 'away', 'dnd']

export const NetworkSettingsModal: React.FC<NetworkSettingsModalProps> = ({
  myProfile,
  stats,
  occupiedExts = [],
  systemSettings,
  isSimulatedEnabled,
  isSoundMuted,
  onUpdateProfile,
  onUpdateSystemSettings,
  onToggleSimulated,
  onToggleMute,
  onResetRegistration,
  onClose,
}) => {
  const availableOptions = EXT_OPTIONS.filter(
    (opt) => !occupiedExts.includes(opt.ext) || opt.ext === myProfile.ext
  )
  const [name, setName] = useState(myProfile.name)
  const [ext, setExt] = useState(myProfile.ext)
  const [status, setStatus] = useState<Status>(myProfile.status)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Admin Settings State (for EXT 100)
  const [callRingDuration, setCallRingDuration] = useState<15 | 30 | 45 | 60>(systemSettings.callRingDuration)
  const [pageToneDuration, setPageToneDuration] = useState<15 | 30 | 45 | 'continuous'>(systemSettings.pageToneDuration)
  const [systemName, setSystemName] = useState(systemSettings.systemName)
  const [broadcastPermission, setBroadcastPermission] = useState<'all' | 'admin-only'>(systemSettings.broadcastPermission)
  const [adminPin, setAdminPin] = useState(systemSettings.masterPin || '1234')
  const [adminSavedToast, setAdminSavedToast] = useState(false)
  const [manualIp, setManualIp] = useState('')
  const [discoveredIps, setDiscoveredIps] = useState<string[]>([])
  const [pairStatus, setPairStatus] = useState<string | null>(null)
  const [stationInfo, setStationInfo] = useState<{
    lanIp: string
    port: number
    interfaces: Array<{ name: string; address: string; netmask: string; broadcast: string; subnetPrefix: string | null }>
    discoveredPeers: Array<{ ip: string; port: number; lastSeen: number; isManual?: boolean }>
  } | null>(null)
  const [isScanningSubnet, setIsScanningSubnet] = useState(false)
  const [scanMessage, setScanMessage] = useState<string | null>(null)
  const [firewallStatus, setFirewallStatus] = useState<string | null>(null)
  const [networkProfile, setNetworkProfile] = useState<string | null>(null)
  const [fixingProfile, setFixingProfile] = useState(false)
  const [profileFixResult, setProfileFixResult] = useState<string | null>(null)

  useEffect(() => {
    p2pNetwork.getNetworkPeerNodes().then((list) => {
      setDiscoveredIps(list.map((p) => `${p.ip}:${p.port || 8443}`))
    })
    p2pNetwork.getStationNetworkInfo().then((info) => {
      if (info) setStationInfo(info)
    })
    p2pNetwork.getNetworkProfile().then((prof) => {
      if (prof) setNetworkProfile(prof)
    })
  }, [])

  const handleSave = () => {
    const cleanName = name.trim()
    if (!cleanName || cleanName.length < 2) {
      setError('Operator / Staff name cannot be empty (min 2 characters)')
      sound.playRogerBeep()
      return
    }

    // If switching to EXT 100 from another extension, verify PIN
    if (ext === '100' && myProfile.ext !== '100') {
      if (pin.trim() !== (systemSettings.masterPin || '1234').trim()) {
        setError('Invalid Master Admin PIN. (Default: 1234)')
        sound.playDisconnectTone()
        return
      }
    }

    sound.playKeyClick()

    // If currently EXT 100, save and broadcast system settings as well
    if (myProfile.ext === '100' || ext === '100') {
      const newSysSettings: SystemSettings = {
        callRingDuration,
        pageToneDuration,
        systemName: systemName.trim() || 'OPAP MOBILE INTERCOM',
        broadcastPermission,
        masterPin: adminPin.trim() || '1234',
        lastUpdatedBy: cleanName,
        lastUpdatedAt: Date.now(),
      }
      onUpdateSystemSettings(newSysSettings)
    }

    onUpdateProfile({
      name: cleanName,
      full: ext === '100' ? `${cleanName} (Admin)` : `${cleanName} Unit`,
      ext: ext.trim() || '100',
      status,
    })
    onClose()
  }

  const handleBroadcastAdminSettings = () => {
    sound.playKeyClick()
    const newSysSettings: SystemSettings = {
      callRingDuration,
      pageToneDuration,
      systemName: systemName.trim() || 'OPAP MOBILE INTERCOM',
      broadcastPermission,
      masterPin: adminPin.trim() || '1234',
      lastUpdatedBy: myProfile.name,
      lastUpdatedAt: Date.now(),
    }
    onUpdateSystemSettings(newSysSettings)
    setAdminSavedToast(true)
    setTimeout(() => setAdminSavedToast(false), 2500)
  }

  const handleCopyLink = () => {
    sound.playKeyClick()
    const url = window.location.href
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: '44px',
        left: '8px',
        right: '8px',
        bottom: '36px',
        background: 'rgba(9, 9, 17, 0.98)',
        backdropFilter: 'blur(8px)',
        zIndex: 85,
        display: 'flex',
        flexDirection: 'column',
        padding: '10px 10px 8px',
        borderRadius: '10px',
        border: '1.5px solid #3b82f6',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.95), 0 0 15px rgba(59, 130, 246, 0.3)',
        overflowY: 'auto',
        scrollbarWidth: 'none',
        pointerEvents: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ fontSize: '13px' }}>⚙️</span>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '9px',
              letterSpacing: '0.1em',
              color: '#60a5fa',
              fontWeight: 600,
            }}
          >
            P2P LAN DIAGNOSTICS
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            fontSize: '14px',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ×
        </button>
      </div>

      {/* Identity Configuration */}
      <div style={{ background: '#111827', padding: '6px 8px', borderRadius: '6px', marginBottom: '7px' }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '7.5px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
          MY UNIT IDENTITY
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '4px', marginBottom: '4px' }}>
          <div>
            <label style={{ fontSize: '7px', color: '#64748b', display: 'block' }}>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: '100%',
                background: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '4px',
                padding: '3px 5px',
                fontFamily: 'Inter, sans-serif',
                fontSize: '9px',
                color: '#fff',
                outline: 'none',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '7px', color: '#64748b', display: 'block' }}>Extension</label>
            <select
              value={ext}
              onChange={(e) => setExt(e.target.value)}
              style={{
                width: '100%',
                background: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '4px',
                padding: '3px 5px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '8.5px',
                color: '#22c55e',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {availableOptions.map((opt) => (
                <option key={opt.ext} value={opt.ext} style={{ background: '#0f172a', color: '#22c55e' }}>
                  {opt.ext} {opt.ext === myProfile.ext ? '(Current)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* PIN verification if user switches to EXT 100 */}
        {ext === '100' && myProfile.ext !== '100' && (
          <div
            style={{
              marginTop: '4px',
              background: '#1e293b',
              border: '1px solid #f59e0b',
              borderRadius: '5px',
              padding: '4px 6px',
            }}
          >
            <label style={{ fontSize: '7px', color: '#f59e0b', display: 'block', fontWeight: 700, marginBottom: '2px' }}>
              🔐 ENTER MASTER ADMIN PIN (Default: 1234):
            </label>
            <input
              type="password"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value)
                if (error) setError(null)
              }}
              placeholder="Admin PIN"
              maxLength={6}
              style={{
                width: '100%',
                background: '#0f172a',
                border: error ? '1px solid #ef4444' : '1px solid #f59e0b',
                borderRadius: '4px',
                padding: '3px 5px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '9px',
                color: '#f59e0b',
                outline: 'none',
                textAlign: 'center',
                letterSpacing: '0.15em',
                boxSizing: 'border-box',
              }}
            />
            {error && <span style={{ fontSize: '6.5px', color: '#ef4444', display: 'block', marginTop: '2px' }}>{error}</span>}
          </div>
        )}

        {/* Status selector */}
        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
          {STATUS_CYCLE.map((st) => (
            <button
              key={st}
              onClick={() => {
                sound.playKeyClick()
                setStatus(st)
              }}
              style={{
                flex: 1,
                padding: '3px',
                borderRadius: '4px',
                background: status === st ? '#2563eb' : '#1f2937',
                border: `1px solid ${status === st ? '#60a5fa' : '#374151'}`,
                color: '#fff',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '7px',
                cursor: 'pointer',
              }}
            >
              {st.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Re-register station identity button */}
        {onResetRegistration && (
          <button
            type="button"
            onClick={() => {
              sound.playKeyClick()
              onResetRegistration()
              onClose()
            }}
            style={{
              width: '100%',
              marginTop: '5px',
              padding: '4px 6px',
              borderRadius: '4px',
              background: '#1e293b',
              border: '1px dashed #64748b',
              color: '#94a3b8',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '6.5px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            <span>🔄</span>
            <span>RE-CONFIGURE STATION IDENTITY / LOGOUT</span>
          </button>
        )}
      </div>

      {/* ── EXT 100 ADMIN MASTER CONTROLS (SYSTEM SETTINGS APPLIED TO ALL EXTS) ── */}
      {myProfile.ext === '100' && (
        <div
          style={{
            background: 'linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%)',
            padding: '7px 8px',
            borderRadius: '6px',
            border: '1px solid #818cf8',
            boxShadow: '0 0 14px rgba(99, 102, 241, 0.25)',
            marginBottom: '7px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '8px',
                color: '#a5b4fc',
                fontWeight: 700,
                letterSpacing: '0.08em',
              }}
            >
              👑 EXT 100 MASTER ADMIN CONTROLS
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '6.5px',
                color: '#38bdf8',
                background: '#1e293b',
                padding: '1px 4px',
                borderRadius: '3px',
              }}
            >
              APPLIES TO ALL EXTS
            </span>
          </div>

          {/* 1. Call Ring Duration */}
          <div style={{ marginBottom: '6px' }}>
            <label style={{ fontSize: '7px', color: '#cbd5e1', display: 'block', marginBottom: '2px', fontFamily: "'JetBrains Mono', monospace" }}>
              CALL RING DURATION:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3px' }}>
              {([15, 30, 45, 60] as const).map((secs) => (
                <button
                  key={secs}
                  type="button"
                  onClick={() => {
                    sound.playKeyClick()
                    setCallRingDuration(secs)
                  }}
                  style={{
                    padding: '3px 1px',
                    borderRadius: '4px',
                    background: callRingDuration === secs ? '#4f46e5' : '#1e293b',
                    border: `1px solid ${callRingDuration === secs ? '#818cf8' : '#334155'}`,
                    color: callRingDuration === secs ? '#fff' : '#94a3b8',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '7.5px',
                    fontWeight: callRingDuration === secs ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {secs}s {secs === 30 ? '★' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Page Tone Duration */}
          <div style={{ marginBottom: '6px' }}>
            <label style={{ fontSize: '7px', color: '#cbd5e1', display: 'block', marginBottom: '2px', fontFamily: "'JetBrains Mono', monospace" }}>
              PAGE TONE DURATION:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3px' }}>
              {([15, 30, 45, 'continuous'] as const).map((opt) => (
                <button
                  key={String(opt)}
                  type="button"
                  onClick={() => {
                    sound.playKeyClick()
                    setPageToneDuration(opt)
                  }}
                  style={{
                    padding: '3px 1px',
                    borderRadius: '4px',
                    background: pageToneDuration === opt ? '#d97706' : '#1e293b',
                    border: `1px solid ${pageToneDuration === opt ? '#fbbf24' : '#334155'}`,
                    color: pageToneDuration === opt ? '#fff' : '#94a3b8',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '7.5px',
                    fontWeight: pageToneDuration === opt ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {opt === 'continuous' ? 'CONTINUOUS' : `${opt}s`}
                </button>
              ))}
            </div>
          </div>

          {/* 3. System Name & Master PIN */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.8fr', gap: '4px', marginBottom: '6px' }}>
            <div>
              <label style={{ fontSize: '7px', color: '#cbd5e1', display: 'block', marginBottom: '2px' }}>
                System Network Title:
              </label>
              <input
                value={systemName}
                onChange={(e) => setSystemName(e.target.value)}
                placeholder="OPAP MOBILE INTERCOM"
                style={{
                  width: '100%',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '4px',
                  padding: '3px 5px',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '8px',
                  color: '#fff',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '7px', color: '#f59e0b', display: 'block', marginBottom: '2px', fontWeight: 600 }}>
                Master PIN:
              </label>
              <input
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                placeholder="1234"
                maxLength={6}
                style={{
                  width: '100%',
                  background: '#0f172a',
                  border: '1px solid #f59e0b88',
                  borderRadius: '4px',
                  padding: '3px 5px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '8.5px',
                  color: '#f59e0b',
                  outline: 'none',
                  textAlign: 'center',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* 4. Broadcast Permissions */}
          <div style={{ marginBottom: '6px' }}>
            <label style={{ fontSize: '7px', color: '#cbd5e1', display: 'block', marginBottom: '2px', fontFamily: "'JetBrains Mono', monospace" }}>
              PA BROADCAST PERMISSION:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px' }}>
              <button
                type="button"
                onClick={() => {
                  sound.playKeyClick()
                  setBroadcastPermission('all')
                }}
                style={{
                  padding: '3px',
                  borderRadius: '4px',
                  background: broadcastPermission === 'all' ? '#059669' : '#1e293b',
                  border: `1px solid ${broadcastPermission === 'all' ? '#34d399' : '#334155'}`,
                  color: broadcastPermission === 'all' ? '#fff' : '#94a3b8',
                  fontSize: '7.5px',
                  fontWeight: broadcastPermission === 'all' ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                All Extensions Allowed
              </button>
              <button
                type="button"
                onClick={() => {
                  sound.playKeyClick()
                  setBroadcastPermission('admin-only')
                }}
                style={{
                  padding: '3px',
                  borderRadius: '4px',
                  background: broadcastPermission === 'admin-only' ? '#dc2626' : '#1e293b',
                  border: `1px solid ${broadcastPermission === 'admin-only' ? '#f87171' : '#334155'}`,
                  color: broadcastPermission === 'admin-only' ? '#fff' : '#94a3b8',
                  fontSize: '7.5px',
                  fontWeight: broadcastPermission === 'admin-only' ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                EXT 100 Admin Only
              </button>
            </div>
          </div>

          {/* Sync Button */}
          <button
            type="button"
            onClick={handleBroadcastAdminSettings}
            style={{
              width: '100%',
              padding: '4px',
              borderRadius: '4px',
              background: 'linear-gradient(180deg, #4f46e5 0%, #4338ca 100%)',
              border: '1px solid #818cf8',
              color: '#ffffff',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '8px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            <span>📡</span>
            <span>{adminSavedToast ? '✓ SYSTEM SETTINGS SYNCED TO MESH' : 'SYNC CONFIG TO ALL CONNECTED UNITS'}</span>
          </button>
        </div>
      )}

      {/* Network Diagnostics */}
      <div style={{ background: '#111827', padding: '6px 8px', borderRadius: '6px', marginBottom: '7px' }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '7.5px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
          SERVERLESS MESH STATUS
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '8px', color: '#cbd5e1' }}>
          <div>
            <span style={{ color: '#64748b' }}>Peers Online:</span> {stats.peerCount}
          </div>
          <div>
            <span style={{ color: '#64748b' }}>LAN Latency:</span> {stats.latencyMs}ms
          </div>
          <div>
            <span style={{ color: '#64748b' }}>Packets TX:</span> {stats.packetsSent}
          </div>
          <div>
            <span style={{ color: '#64748b' }}>Packets RX:</span> {stats.packetsReceived}
          </div>
        </div>
      </div>

      {/* LAN Mesh, Zero-Config Subnet Probe & Remote PC Pairing */}
      <div style={{ background: '#111827', padding: '6px 8px', borderRadius: '6px', marginBottom: '7px' }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '7.5px', color: '#94a3b8', display: 'block', marginBottom: '3px' }}>
          LAN ZERO-CONFIG MESH & PEER DISCOVERY
        </span>

        {/* Local IP & Physical Adapter Telemetry */}
        <div style={{ fontSize: '7.5px', color: '#38bdf8', marginBottom: '5px', fontFamily: "'JetBrains Mono', monospace", background: '#0f172a', padding: '4px 6px', borderRadius: '4px', border: '1px solid #1e293b' }}>
          <div><span style={{ color: '#64748b' }}>My Station IP:</span> {stationInfo ? stationInfo.lanIp : 'Detecting...'} (Port {stationInfo ? stationInfo.port : '8443'})</div>
          {stationInfo && stationInfo.interfaces && stationInfo.interfaces.length > 0 && (
            <div style={{ color: '#a78bfa', marginTop: '2px' }}>
              <span style={{ color: '#64748b' }}>Subnet:</span> {stationInfo.interfaces[0].subnetPrefix ? stationInfo.interfaces[0].subnetPrefix + 'x' : 'LAN'} ({stationInfo.interfaces[0].name})
            </div>
          )}
          {networkProfile && (
            <div style={{ marginTop: '3px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ color: '#64748b' }}>Windows Profile: </span>
                <span style={{ color: networkProfile === 'Private' ? '#22c55e' : '#f59e0b', fontWeight: 600 }}>
                  {networkProfile.toUpperCase()}
                </span>
                {networkProfile === 'Public' && <span style={{ color: '#ef4444', marginLeft: '4px' }}>(Blocks LAN)</span>}
              </div>
              {networkProfile !== 'Private' && (
                <button
                  type="button"
                  disabled={fixingProfile}
                  onClick={async () => {
                    sound.playKeyClick()
                    setFixingProfile(true)
                    setProfileFixResult('Applying...')
                    const res = await p2pNetwork.fixNetworkProfile()
                    setFixingProfile(false)
                    if (res.ok) {
                      setNetworkProfile('Private')
                      setProfileFixResult('✓ Private Profile Set!')
                    } else {
                      // Try elevate
                      const fw = await p2pNetwork.authorizeFirewall()
                      if (fw.ok) {
                        setNetworkProfile('Private')
                        setProfileFixResult('✓ Private Profile Set!')
                      } else {
                        setProfileFixResult('Requires Admin')
                      }
                    }
                    setTimeout(() => setProfileFixResult(null), 3500)
                  }}
                  style={{
                    background: '#d97706',
                    border: '1px solid #fbbf24',
                    borderRadius: '3px',
                    color: '#fff',
                    padding: '1px 5px',
                    fontSize: '6.5px',
                    fontFamily: "'JetBrains Mono', monospace",
                    cursor: fixingProfile ? 'wait' : 'pointer',
                    fontWeight: 700,
                  }}
                >
                  {profileFixResult || (fixingProfile ? 'SETTING...' : 'SET PRIVATE')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Subnet Auto-Scan & Firewall Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '5px' }}>
          <button
            type="button"
            disabled={isScanningSubnet}
            onClick={async () => {
              sound.playKeyClick()
              setIsScanningSubnet(true)
              setScanMessage('Scanning subnet...')
              const peers = await p2pNetwork.triggerSubnetScan()
              setIsScanningSubnet(false)
              setScanMessage(`✓ Found ${peers.length} station(s)`)
              setTimeout(() => setScanMessage(null), 3000)
              p2pNetwork.getNetworkPeerNodes().then((list) => {
                setDiscoveredIps(list.map((p) => `${p.ip}:${p.port || 8443}`))
              })
            }}
            style={{
              padding: '4px 6px',
              background: isScanningSubnet ? '#1e293b' : '#047857',
              border: '1px solid #10b981',
              borderRadius: '4px',
              color: '#fff',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '7px',
              cursor: isScanningSubnet ? 'wait' : 'pointer',
              fontWeight: 600,
              textAlign: 'center',
            }}
          >
            {scanMessage || (isScanningSubnet ? '⏳ SCANNING...' : '🔍 SCAN SUBNET NOW')}
          </button>

          <button
            type="button"
            onClick={async () => {
              sound.playKeyClick()
              setFirewallStatus('Opening prompt...')
              const res = await p2pNetwork.authorizeFirewall()
              if (res.ok) {
                setFirewallStatus('✓ Rules Allowed!')
              } else {
                setFirewallStatus(res.error ? 'Requires Admin' : 'Manual rules')
              }
              setTimeout(() => setFirewallStatus(null), 3500)
            }}
            style={{
              padding: '4px 6px',
              background: '#1e293b',
              border: '1px solid #64748b',
              borderRadius: '4px',
              color: '#e2e8f0',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '7px',
              cursor: 'pointer',
              fontWeight: 600,
              textAlign: 'center',
            }}
          >
            {firewallStatus || '🛡️ ALLOW FIREWALL'}
          </button>
        </div>

        {/* Manual IP Pair Fallback */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
          <input
            placeholder="Manual IP (e.g. 192.168.100.50)"
            value={manualIp}
            onChange={(e) => setManualIp(e.target.value)}
            style={{
              flex: 1,
              background: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '4px',
              padding: '3px 5px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '7.5px',
              color: '#38bdf8',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={async () => {
              if (!manualIp.trim()) return
              sound.playKeyClick()
              setPairStatus('Connecting...')
              await p2pNetwork.addManualPeer(manualIp.trim())
              setPairStatus('✓ Paired!')
              setManualIp('')
              setTimeout(() => setPairStatus(null), 2500)
              p2pNetwork.getNetworkPeerNodes().then((list) => {
                setDiscoveredIps(list.map((p) => `${p.ip}:${p.port || 8443}`))
              })
            }}
            style={{
              padding: '3px 7px',
              background: '#2563eb',
              border: '1px solid #60a5fa',
              borderRadius: '4px',
              color: '#fff',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '7.5px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {pairStatus || 'CONNECT IP'}
          </button>
        </div>

        {discoveredIps.length > 0 ? (
          <div style={{ fontSize: '7px', color: '#22c55e', marginTop: '2px', fontFamily: "'JetBrains Mono', monospace" }}>
            ✓ Active PC Stations: {discoveredIps.join(', ')}
          </div>
        ) : (
          <div style={{ fontSize: '7px', color: '#94a3b8', marginTop: '2px', fontFamily: "'JetBrains Mono', monospace" }}>
            Auto-Discovery: TCP Subnet Sweep & UDP Beacon (Port 8445)
          </div>
        )}
      </div>

      {/* LAN Multi-tab / Multi-device link */}
      <div style={{ background: '#111827', padding: '6px 8px', borderRadius: '6px', marginBottom: '7px' }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '7.5px', color: '#94a3b8', display: 'block', marginBottom: '3px' }}>
          CONNECT MORE DEVICES / TABS
        </span>
        <p style={{ fontSize: '7px', color: '#64748b', margin: '0 0 4px 0', lineHeight: 1.2 }}>
          Open this app in multiple tabs or devices on your LAN to test instant P2P intercom calls!
        </p>
        <button
          onClick={handleCopyLink}
          style={{
            width: '100%',
            padding: '4px',
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '4px',
            color: copied ? '#22c55e' : '#93c5fd',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '7.5px',
            cursor: 'pointer',
          }}
        >
          {copied ? '✓ LINK COPIED TO CLIPBOARD' : '📋 COPY LOCAL APP LINK'}
        </button>
      </div>

      {/* Audio & Demo Toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
        {/* Demo Mode Toggle */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '8px',
            color: '#e2e8f0',
            cursor: 'pointer',
            background: '#111827',
            padding: '5px 8px',
            borderRadius: '5px',
          }}
        >
          <span>Colleague Bots (Demo Mode)</span>
          <input
            type="checkbox"
            checked={isSimulatedEnabled}
            onChange={(e) => {
              sound.playKeyClick()
              onToggleSimulated(e.target.checked)
            }}
          />
        </label>

        {/* Sound FX Mute Toggle */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '8px',
            color: '#e2e8f0',
            cursor: 'pointer',
            background: '#111827',
            padding: '5px 8px',
            borderRadius: '5px',
          }}
        >
          <span>Sound Effects (Chimes & Tones)</span>
          <input
            type="checkbox"
            checked={!isSoundMuted}
            onChange={(e) => {
              sound.playKeyClick()
              onToggleMute(!e.target.checked)
            }}
          />
        </label>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        style={{
          marginTop: 'auto',
          padding: '6px',
          borderRadius: '6px',
          background: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
          border: '1px solid #60a5fa',
          color: '#fff',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '9px',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        SAVE & APPLY
      </button>
    </div>
  )
}
