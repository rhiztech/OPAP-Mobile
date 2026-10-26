import React from 'react'
import { Peer, CallState, Status } from '../types/opap'

interface LcdScreenProps {
  clock: string
  myStatus: Status
  myExt: string
  selected: Peer | null
  callState: CallState
  callTimer: number
  audioLevel: number
  broadcastAlert: string | null
  peerCount: number
  systemName?: string
  pageToneDuration?: number | 'continuous'
  volume?: number
  onVolumeChange?: (vol: number) => void
  isMuted?: boolean
  onToggleMuteMic?: () => void
  heldPeer?: Peer | null
  isConference?: boolean
  isHeldByRemote?: boolean
  activeCallCount?: number
  candidatePeer?: Peer | null
}

const STATUS_COLOR: Record<Status, string> = {
  idle: '#22c55e',
  busy: '#f59e0b',
  away: '#6b7280',
  dnd: '#ef4444',
}

const STATUS_LABEL: Record<Status, string> = {
  idle: 'IDLE',
  busy: 'BUSY',
  away: 'AWAY',
  dnd: 'DND',
}

function fmtTimer(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, '0')
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

export const LcdScreen: React.FC<LcdScreenProps> = ({
  clock,
  myStatus,
  myExt,
  selected,
  callState,
  callTimer,
  audioLevel,
  broadcastAlert,
  peerCount,
  systemName,
  pageToneDuration = 15,
  volume = 80,
  onVolumeChange,
  isMuted = false,
  onToggleMuteMic,
  heldPeer,
  isConference = false,
  isHeldByRemote = false,
  activeCallCount = 1,
  candidatePeer,
}) => {
  const [internalVol, setInternalVol] = React.useState<number>(() => {
    if (typeof volume === 'number') return volume
    try {
      const saved = localStorage.getItem('opap_volume_level')
      if (saved !== null) {
        const p = parseInt(saved, 10)
        if (!isNaN(p)) return Math.max(0, Math.min(100, p))
      }
    } catch {}
    return 80
  })

  const prevVolRef = React.useRef<number>(80)
  const currentVol = typeof volume === 'number' ? volume : internalVol

  const handleSliderChange = (newVal: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(newVal)))
    if (clamped > 0) {
      prevVolRef.current = clamped
    }
    setInternalVol(clamped)
    onVolumeChange?.(clamped)
  }

  const handleToggleMute = () => {
    if (currentVol > 0) {
      prevVolRef.current = currentVol
      handleSliderChange(0)
    } else {
      handleSliderChange(prevVolRef.current || 80)
    }
  }
  const isUnassigned = selected?.name === 'UNASSIGNED' || selected?.id?.startsWith('unassigned-')

  // Main Display Line (with GSM Telephony Multi-Call States)
  let displayTitle = 'READY // STANDBY'
  if (broadcastAlert) {
    displayTitle = `📢 ${broadcastAlert.toUpperCase()}`
  } else if (callState === 'calling') {
    displayTitle = `DIALING EXT ${selected?.ext || '---'}...`
  } else if (callState === 'paging') {
    displayTitle = `🚨 PAGING EXT ${selected?.ext || '---'} (${pageToneDuration === 'continuous' ? 'CONT' : `${pageToneDuration}s`})...`
  } else if (callState === 'receiving-page') {
    displayTitle = `🚨 INCOMING PAGER BEEP!`
  } else if (callState === 'ringing') {
    displayTitle = `INCOMING CALL: EXT ${selected?.ext || '---'}`
  } else if (candidatePeer && callState === 'active') {
    const isCandUnassigned = candidatePeer.name === 'UNASSIGNED' || candidatePeer.id.startsWith('unassigned-')
    displayTitle = isCandUnassigned
      ? `EXT ${candidatePeer.ext} UNASSIGNED`
      : `➕ ADD EXT ${candidatePeer.ext} (${candidatePeer.name.slice(0, 10)})?`
  } else if (isHeldByRemote) {
    displayTitle = `⏸️ CALL ON HOLD // STANDBY`
  } else if (isConference) {
    displayTitle = `👥 GROUP CONFERENCE ACTIVE`
  } else if (callState === 'active') {
    if (heldPeer) {
      displayTitle = selected
        ? `ACTIVE: EXT ${selected.ext} (${selected.name})`
        : `VOICE CALL ACTIVE`
    } else {
      displayTitle = selected
        ? `VOICE CALL ACTIVE · EXT ${selected.ext}`
        : `VOICE CALL ACTIVE`
    }
  } else if (callState === 'ended') {
    displayTitle = 'CALL DISCONNECTED'
  } else if (selected) {
    if (isUnassigned) {
      displayTitle = `Ready // EXT ${selected.ext} UNASSIGNED`
    } else {
      displayTitle = `Ready // EXT ${selected.ext} SELECTED`
    }
  }

  // Subtitle / Telemetry Line
  let subTitle = `MESH ONLINE · ${peerCount} UNITS ACTIVE`
  if (candidatePeer && callState === 'active') {
    const isCandUnassigned = candidatePeer.name === 'UNASSIGNED' || candidatePeer.id.startsWith('unassigned-')
    if (isCandUnassigned) {
      subTitle = `EXT ${candidatePeer.ext} UNASSIGNED · CANNOT ADD TO CALL`
    } else {
      subTitle = `[STANDBY CALL] OR [GROUP CONF] · CHOOSE ACTION BELOW`
    }
  } else if (isHeldByRemote) {
    subTitle = `REMOTE STATION PUT CALL ON HOLD · STANDBY`
  } else if (isConference) {
    subTitle = heldPeer
      ? `3-WAY CONF: ${selected?.name || 'EXT ' + selected?.ext} + ${heldPeer.name || 'EXT ' + heldPeer.ext}`
      : `3-WAY GROUP CONFERENCE RX/TX · FULL DUPLEX`
  } else if (callState === 'active') {
    if (heldPeer) {
      subTitle = `⏸️ ON HOLD: EXT ${heldPeer.ext} (${heldPeer.name}) · [SWAP] TO TOGGLE`
    } else {
      subTitle = selected
        ? `2-WAY AUDIO RX/TX WITH ${selected.name.toUpperCase()} (EXT ${selected.ext})`
        : `2-WAY AUDIO RX/TX · 16kHz`
    }
  } else if (callState === 'calling') {
    subTitle = `CALLING ${selected?.name?.toUpperCase() || 'UNIT'} (EXT ${selected?.ext || '---'})...`
  } else if (callState === 'paging') {
    subTitle = 'TRANSMITTING URGENT PAGER BEEP...'
  } else if (callState === 'receiving-page') {
    subTitle = pageToneDuration === 'continuous' ? 'URGENT PAGER BEEP ACTIVE (CONT)' : `URGENT PAGER BEEP ACTIVE (${pageToneDuration}s)`
  } else if (selected) {
    if (isUnassigned) {
      subTitle = `UNASSIGNED DIALER · CANNOT CALL / MSG`
    } else {
      subTitle = `STATUS: ${STATUS_LABEL[selected.status] || 'IDLE'} · DIRECT LAN`
    }
  }

  // 14-band Equalizer VU visualizer
  const eqBars = Array.from({ length: 14 }, (_, i) => {
    if (callState !== 'active') return 3
    const variance = Math.sin(Date.now() / 120 + i * 0.75) * 25
    const height = Math.max(4, Math.min(100, audioLevel * 0.95 + variance))
    return Math.round(height)
  })

  return (
    <div
      style={{
        background: 'linear-gradient(180deg, #010a02 0%, #031405 100%)',
        borderRadius: '8px',
        padding: '7px 10px 6px',
        border: '1.5px solid #15803d',
        boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.9), 0 0 16px rgba(34,197,94,0.18)',
        marginBottom: '8px',
        position: 'relative',
        overflow: 'hidden',
        height: '66px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      {/* Subtle CRT Glass Reflection (Behind Text so Writing Remains Ultra-Clear) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage:
            'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 40%, transparent 60%)',
          borderRadius: '7px',
          zIndex: 1,
        }}
      />

      {/* Row 1: Header (Left: System Volume & Mic | Right: In Call Status + Digital Clock) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 2,
        }}
      >
        {/* Left: App Sound Volume Control + Mic Mute Toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '3.5px',
            pointerEvents: 'auto',
            zIndex: 10,
          }}
        >
          {/* Speaker Icon Button (Click to Mute / Unmute Audio) */}
          <button
            type="button"
            onClick={handleToggleMute}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              lineHeight: 1,
              outline: 'none',
            }}
            title={currentVol === 0 ? 'Sound Muted · Click to unmute' : `Sound Volume: ${currentVol}% · Click to mute`}
          >
            {currentVol === 0 ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : currentVol < 40 ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#86efac" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 3px rgba(74,222,128,0.7))' }}>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#4ade8022" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>

          {/* Volume Range Slider with 50% reduced micro ball thumb */}
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            className={`lcd-vol-slider ${currentVol === 0 ? 'muted' : ''}`}
            value={currentVol}
            onChange={(e) => handleSliderChange(Number(e.target.value))}
            style={{
              width: '38px',
              height: '3px',
              cursor: 'pointer',
              outline: 'none',
              padding: 0,
              margin: 0,
            }}
            title={`Volume: ${currentVol}%`}
          />

          {/* Level Value */}
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '7.5px',
              color: currentVol === 0 ? '#f87171' : '#86efac',
              letterSpacing: '0.04em',
              fontWeight: 800,
              minWidth: '18px',
              textShadow: currentVol === 0 ? 'none' : '0 0 5px rgba(74,222,128,0.6)',
            }}
          >
            {currentVol === 0 ? 'MUT' : `${currentVol}%`}
          </span>

          {/* Divider */}
          <span style={{ color: '#15803d', fontSize: '7px', opacity: 0.6 }}>|</span>

          {/* Mic Mute Toggle Icon Button */}
          <button
            type="button"
            onClick={onToggleMuteMic}
            style={{
              background: isMuted ? 'rgba(239, 68, 68, 0.25)' : 'none',
              border: isMuted ? '1px solid #ef4444' : 'none',
              borderRadius: '3px',
              padding: '1px 2px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              lineHeight: 1,
              outline: 'none',
              transition: 'all 0.15s ease',
            }}
            title={isMuted ? 'Microphone Muted · Click to unmute' : 'Microphone Active · Click to mute mic'}
          >
            {isMuted ? (
              <svg
                width="9.5"
                height="9.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ef4444"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ filter: 'drop-shadow(0 0 3px rgba(239,68,68,0.8))' }}
              >
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            ) : (
              <svg
                width="9.5"
                height="9.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#4ade80"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ filter: 'drop-shadow(0 0 3px rgba(74,222,128,0.7))' }}
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="#4ade8022" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {callState === 'active' || isHeldByRemote ? (
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '8.5px',
                color: isHeldByRemote ? '#38bdf8' : isConference ? '#a855f7' : heldPeer ? '#fbbf24' : '#fbbf24',
                letterSpacing: '0.06em',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              {isHeldByRemote ? (
                <>
                  <span style={{ color: '#38bdf8' }}>⏸️</span>
                  <span>ON HOLD</span>
                </>
              ) : isConference ? (
                <>
                  <span style={{ color: '#a855f7' }}>👥</span>
                  <span>CONF (3)</span>
                </>
              ) : heldPeer ? (
                <>
                  <span style={{ color: '#ef4444', animation: 'pulse-dot 1s infinite' }}>🔴</span>
                  <span>2 CALLS</span>
                </>
              ) : (
                <>
                  <span style={{ color: '#ef4444', animation: 'pulse-dot 1s infinite' }}>🔴</span>
                  <span>IN CALL</span>
                </>
              )}
            </span>
          ) : (
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '8.5px',
                color: '#4ade80',
                letterSpacing: '0.06em',
                fontWeight: 700,
              }}
            >
              EXT {myExt}
            </span>
          )}
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '9.5px',
              color: '#ffffff',
              fontWeight: 800,
              letterSpacing: '0.04em',
              textShadow: '0 0 8px rgba(255,255,255,0.6), 0 0 12px rgba(74,222,128,0.7)',
            }}
          >
            {clock}
          </span>
        </div>
      </div>

      {/* Row 2: Large High-Visibility Center Phosphor Text */}
      <div
        style={{
          zIndex: 2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          padding: '0.5px 0',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '15px',
            color: broadcastAlert ? '#fde047' : isUnassigned ? '#fca5a5' : '#4ade80',
            letterSpacing: '0.02em',
            textShadow: broadcastAlert
              ? '0 0 10px rgba(253,224,71,0.9), 0 0 3px #ffffff'
              : isUnassigned
              ? '0 0 10px rgba(252,165,165,0.8), 0 0 3px #ffffff'
              : '0 0 10px rgba(74,222,128,0.9), 0 0 3px rgba(255,255,255,0.8)',
            fontWeight: 800,
            lineHeight: 1.1,
          }}
        >
          {displayTitle}
        </span>
      </div>

      {/* Row 3: Clear Subtitle Telemetry & Fluorescent Equalizer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 2,
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '8px',
            color: isUnassigned ? '#fca5a5' : '#bbf7d0',
            letterSpacing: '0.04em',
            fontWeight: 700,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '190px',
            textShadow: isUnassigned ? '0 0 4px rgba(252,165,165,0.5)' : '0 0 4px rgba(187,247,208,0.6)',
          }}
        >
          {subTitle}
        </span>

        {/* 14-band High-Brightness Audio VU meter */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1.5px', height: '10px' }}>
          {eqBars.map((h, i) => (
            <div
              key={i}
              style={{
                width: '2.5px',
                height: `${h}%`,
                background:
                  callState === 'active'
                    ? h > 70
                      ? '#ef4444'
                      : h > 40
                      ? '#f59e0b'
                      : '#22c55e'
                    : '#166534',
                boxShadow:
                  callState === 'active'
                    ? h > 70
                      ? '0 0 4px #ef4444'
                      : h > 40
                      ? '0 0 4px #f59e0b'
                      : '0 0 4px #22c55e'
                    : 'none',
                borderRadius: '0.5px',
                transition: 'height 0.08s ease',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
