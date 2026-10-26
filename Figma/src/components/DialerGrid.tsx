import React from 'react'
import { CallState, Peer, Status } from '../types/opap'
import { sound } from '../services/soundSynthesizer'

interface DialerGridProps {
  peers: Peer[]
  myProfile: Peer
  selected: Peer | null
  callActive: boolean
  callState?: CallState
  heldPeer?: Peer | null
  isConference?: boolean
  candidatePeer?: Peer | null
  onSelectPeer: (peer: Peer) => void
  onSwapCalls?: () => void
  onSelectCandidate?: (peer: Peer) => void
}

const STATUS_COLOR: Record<Status, string> = {
  idle: '#22c55e',
  busy: '#f59e0b',
  away: '#6b7280',
  dnd: '#ef4444',
}

export const DialerGrid: React.FC<DialerGridProps> = ({
  peers,
  myProfile,
  selected,
  callActive,
  callState,
  heldPeer,
  isConference,
  candidatePeer,
  onSelectPeer,
  onSwapCalls,
  onSelectCandidate,
}) => {
  const isCallActiveNow = Boolean(
    callActive ||
    callState === 'active' ||
    callState === 'calling' ||
    callState === 'ringing'
  )

  const activePartnerExt = String(selected?.ext || '').trim()
  const heldPartnerExt = String(heldPeer?.ext || '').trim()

  // Strict 1-to-1 Slot-to-Extension Mapping:
  // Slot 1 = EXT 101, Slot 2 = EXT 102, ..., Slot 9 = EXT 109
  const slots = Array.from({ length: 9 }, (_, index) => {
    const slotNum = index + 1
    const targetExt = `10${slotNum}`

    const isMe =
      String(myProfile.ext).trim() === targetExt ||
      String(myProfile.ext).trim() === String(slotNum)

    // Check if a remote LAN peer has registered this exact extension or if selected matches this slot
    const matchedPeer = !isMe
      ? peers.find((p) => String(p.ext).trim() === targetExt || String(p.ext).trim() === String(slotNum)) ||
        (selected && (String(selected.ext).trim() === targetExt || String(selected.ext).trim() === String(slotNum)) ? selected : null)
      : null

    return { slotIndex: slotNum, targetExt, peer: matchedPeer, isMe }
  })

  const handleKeyClick = (slot: { slotIndex: number; targetExt: string; peer: Peer | null; isMe: boolean }) => {
    if (slot.isMe) {
      sound.playKeyClick()
      return
    }

    // GSM Telephony Rule: If clicking the held peer, swap calls!
    const isThisSlotHeld = Boolean(
      heldPartnerExt && (slot.targetExt === heldPartnerExt || String(slot.slotIndex) === heldPartnerExt)
    )
    if (isThisSlotHeld && onSwapCalls) {
      onSwapCalls()
      return
    }

    sound.playKeyClick()
    sound.playDtmf(String(slot.slotIndex))

    const isSlotUnassigned = !slot.peer || slot.peer.name === 'UNASSIGNED' || slot.peer.id.startsWith('unassigned-')

    // In an active call: only assigned online units can be selected as candidates!
    // Unassigned extensions CANNOT be added to a call.
    if (isCallActiveNow) {
      if (isSlotUnassigned) {
        sound.playDisconnectTone()
        return
      }
      if (onSelectCandidate) {
        onSelectCandidate(slot.peer!)
      } else {
        onSelectPeer(slot.peer!)
      }
      return
    }

    const targetPeer = slot.peer || {
      id: `unassigned-ext-${slot.targetExt}`,
      name: 'UNASSIGNED',
      full: `Unassigned Unit (EXT ${slot.targetExt})`,
      ext: slot.targetExt,
      status: 'away' as const,
      lastSeen: 0,
    }

    onSelectPeer(targetPeer)
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gap: '6px',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {slots.map(({ slotIndex, targetExt, peer, isMe }) => {
        const isRegistered = Boolean(peer) || isMe
        const isSlotUnassigned = !peer || peer.name === 'UNASSIGNED' || peer.id.startsWith('unassigned-')

        // 1. Is local station (YOU) in call?
        const isMeInActiveCall = isMe && isCallActiveNow

        // 2. Is this slot the active remote partner in the call?
        const isPeerInActiveCallWithMe =
          !isMe &&
          isCallActiveNow &&
          Boolean(
            (activePartnerExt && (targetExt === activePartnerExt || String(slotIndex) === activePartnerExt || activePartnerExt.endsWith(String(slotIndex)))) ||
            (peer && (peer.status === 'busy' || selected?.id === peer.id || selected?.ext === peer.ext))
          )

        // 3. Is this slot held / on standby?
        const isPeerHeldWithMe =
          !isMe &&
          Boolean(
            heldPartnerExt &&
            (targetExt === heldPartnerExt || String(slotIndex) === heldPartnerExt || heldPartnerExt.endsWith(String(slotIndex)))
          )

        // 4. Is this slot selected as candidate to add? (Never true for unassigned units)
        const isCandidate = Boolean(
          candidatePeer &&
          !isSlotUnassigned &&
          !isMe &&
          !isPeerInActiveCallWithMe &&
          !isPeerHeldWithMe &&
          (candidatePeer.id === peer?.id || candidatePeer.ext === targetExt || String(candidatePeer.ext) === String(slotIndex) || String(candidatePeer.ext) === `10${slotIndex}`)
        )

        const isSel = !isMe && selected && (selected.id === peer?.id || selected.ext === targetExt || String(selected.ext) === String(slotIndex) || String(selected.ext) === `10${slotIndex}`)

        const statusColor = isMe
          ? isMeInActiveCall
            ? '#f59e0b'
            : STATUS_COLOR[myProfile.status] || '#22c55e'
          : peer
          ? isPeerInActiveCallWithMe
            ? '#ef4444'
            : isPeerHeldWithMe
            ? '#f59e0b'
            : isCandidate
            ? '#38bdf8'
            : STATUS_COLOR[peer.status] || '#6b7280'
          : '#33334a'

        const displayName = isMe
          ? myProfile.name.toUpperCase()
          : peer
          ? peer.name.toUpperCase()
          : isPeerInActiveCallWithMe && selected
          ? selected.name.toUpperCase()
          : 'UNASSIGNED'

        return (
          <button
            key={slotIndex}
            onClick={() => handleKeyClick({ slotIndex, targetExt, peer, isMe })}
            disabled={isMe}
            title={
              isMe
                ? isMeInActiveCall
                  ? `${myProfile.name} (In Active Call)`
                  : `${myProfile.name} (This Station - Local)`
                : isPeerInActiveCallWithMe
                ? `In Active Call with ${displayName}`
                : isPeerHeldWithMe
                ? `Call with ${displayName} is on Hold (Click to Swap)`
                : isCallActiveNow
                ? isSlotUnassigned
                  ? `EXT ${targetExt}: UNASSIGNED (Cannot add to call)`
                  : `Click to Add ${displayName} as Group / Standby call`
                : isSlotUnassigned
                ? `EXT ${targetExt}: UNASSIGNED (Cannot call)`
                : `Dial ${displayName}`
            }
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '6px 3px 5px',
              borderRadius: '8px',
              cursor: isMe ? 'default' : isCallActiveNow && isSlotUnassigned ? 'not-allowed' : 'pointer',
              opacity: isMe && !isMeInActiveCall ? 0.8 : isCallActiveNow && isSlotUnassigned ? 0.45 : 1,
              border: isPeerInActiveCallWithMe
                ? '1.5px solid #ef4444'
                : isMeInActiveCall
                ? '1.5px solid #f59e0b'
                : isPeerHeldWithMe
                ? '1.5px solid #fbbf24'
                : isCandidate
                ? '1.5px dashed #38bdf8'
                : isSel
                ? isRegistered
                  ? statusColor + 'cc'
                  : '#3b82f6cc'
                : isMe
                ? '#3b82f644'
                : isRegistered
                ? '#353555'
                : '#222234',
              background: isPeerInActiveCallWithMe
                ? 'linear-gradient(180deg, #381a24 0%, #221018 100%)'
                : isMeInActiveCall
                ? 'linear-gradient(180deg, #382810 0%, #201708 100%)'
                : isPeerHeldWithMe
                ? 'linear-gradient(180deg, #382d10 0%, #1f1807 100%)'
                : isCandidate
                ? 'linear-gradient(180deg, #0c2b42 0%, #061826 100%)'
                : isSel
                ? 'linear-gradient(180deg, #28284e 0%, #1c1c3a 100%)'
                : isMe
                ? 'linear-gradient(180deg, #131d2e 0%, #0d131f 100%)'
                : isRegistered
                ? 'linear-gradient(180deg, #222238 0%, #18182a 100%)'
                : 'linear-gradient(180deg, #181824 0%, #12121c 100%)',
              boxShadow: isPeerInActiveCallWithMe
                ? '0 0 14px rgba(239, 68, 68, 0.6), inset 0 1px 0 rgba(255,255,255,0.2)'
                : isMeInActiveCall
                ? '0 0 14px rgba(245, 158, 11, 0.6), inset 0 1px 0 rgba(255,255,255,0.2)'
                : isPeerHeldWithMe
                ? '0 0 12px rgba(251, 191, 36, 0.6), inset 0 1px 0 rgba(255,255,255,0.2)'
                : isCandidate
                ? '0 0 12px rgba(56, 189, 248, 0.6), inset 0 1px 0 rgba(255,255,255,0.2)'
                : isSel
                ? `0 0 12px ${statusColor}55, inset 0 1px 0 rgba(255,255,255,0.2)`
                : '0 2px 5px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
              transition: 'all 0.12s ease',
              outline: 'none',
              userSelect: 'none',
              height: '100%',
              boxSizing: 'border-box',
            }}
          >
            {/* Top-Right Status LED / Active Call Pill Badge */}
            <div style={{ position: 'absolute', top: '3.5px', right: '4.5px', display: 'flex', alignItems: 'center' }}>
              {isMe ? (
                isMeInActiveCall ? (
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '5.5px',
                      fontWeight: 800,
                      color: '#ffffff',
                      background: '#b45309',
                      padding: '1px 3.5px',
                      borderRadius: '3px',
                      letterSpacing: '0.04em',
                      boxShadow: '0 0 8px rgba(245, 158, 11, 0.8)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                    }}
                  >
                    <span style={{ fontSize: '4.5px' }}>🔴</span>
                    <span>IN CALL</span>
                  </span>
                ) : (
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '5.5px',
                      fontWeight: 700,
                      color: '#60a5fa',
                      background: '#1e3a8a',
                      padding: '0.5px 2.5px',
                      borderRadius: '3px',
                      letterSpacing: '0.04em',
                    }}
                  >
                    YOU
                  </span>
                )
              ) : isConference && (isPeerInActiveCallWithMe || isPeerHeldWithMe) ? (
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '5.5px',
                    fontWeight: 800,
                    color: '#ffffff',
                    background: '#a855f7',
                    padding: '1px 3.5px',
                    borderRadius: '3px',
                    letterSpacing: '0.04em',
                    boxShadow: '0 0 8px rgba(168, 85, 247, 0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                >
                  <span>👥</span>
                  <span>CONF</span>
                </span>
              ) : isPeerInActiveCallWithMe ? (
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '5.5px',
                    fontWeight: 800,
                    color: '#ffffff',
                    background: '#dc2626',
                    padding: '1px 3.5px',
                    borderRadius: '3px',
                    letterSpacing: '0.04em',
                    boxShadow: '0 0 8px rgba(239, 68, 68, 0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                >
                  <span style={{ fontSize: '4.5px' }}>🔴</span>
                  <span>ACTIVE</span>
                </span>
              ) : isPeerHeldWithMe ? (
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '5.5px',
                    fontWeight: 800,
                    color: '#000000',
                    background: '#fbbf24',
                    padding: '1px 3.5px',
                    borderRadius: '3px',
                    letterSpacing: '0.04em',
                    boxShadow: '0 0 8px rgba(251, 191, 36, 0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                >
                  <span style={{ fontSize: '4.5px' }}>⏸️</span>
                  <span>HELD</span>
                </span>
              ) : isCandidate ? (
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '5.5px',
                    fontWeight: 800,
                    color: '#ffffff',
                    background: '#0284c7',
                    padding: '1px 3.5px',
                    borderRadius: '3px',
                    letterSpacing: '0.04em',
                    boxShadow: '0 0 8px rgba(56, 189, 248, 0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                >
                  <span>➕</span>
                  <span>ADD</span>
                </span>
              ) : isRegistered ? (
                <div
                  style={{
                    width: '5px',
                    height: '5px',
                    borderRadius: '50%',
                    background: statusColor,
                    boxShadow: `0 0 5px ${statusColor}`,
                  }}
                />
              ) : null}
            </div>

            {/* Prominent Centered Bold Dialer Pad Number */}
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '18px',
                fontWeight: 800,
                color: isPeerInActiveCallWithMe
                  ? '#fca5a5'
                  : isMeInActiveCall
                  ? '#fde047'
                  : isMe
                  ? '#60a5fa'
                  : isSel
                  ? '#ffffff'
                  : isRegistered
                  ? '#f8fafc'
                  : '#475569',
                lineHeight: 1,
                marginBottom: '3px',
                textAlign: 'center',
                textShadow: isPeerInActiveCallWithMe
                  ? '0 0 8px rgba(239, 68, 68, 0.8)'
                  : isMeInActiveCall
                  ? '0 0 8px rgba(245, 158, 11, 0.8)'
                  : isSel
                  ? '0 0 8px rgba(96, 165, 250, 0.7)'
                  : 'none',
              }}
            >
              {slotIndex}
            </div>

            {/* Staff Name / Label (Prominent & Bold) */}
            <span
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '10px',
                color: isPeerInActiveCallWithMe
                  ? '#fecaca'
                  : isMeInActiveCall
                  ? '#fef08a'
                  : isMe
                  ? '#93c5fd'
                  : isSel
                  ? '#ffffff'
                  : isRegistered
                  ? '#f1f5f9'
                  : '#475569',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '94%',
                lineHeight: 1.2,
                letterSpacing: '0.02em',
                textAlign: 'center',
              }}
            >
              {displayName}
            </span>
          </button>
        )
      })}
    </div>
  )
}
