import React, { useState, useEffect } from 'react'
import { Peer, CallSignal } from '../types/opap'
import { voiceCall } from '../services/voiceCall'
import { sound } from '../services/soundSynthesizer'

interface IncomingCallModalProps {
  caller: Peer
  signal: CallSignal
  callRingDuration?: number
  onAccept: () => void
  onDecline: () => void
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  caller,
  signal,
  callRingDuration = 30,
  onAccept,
  onDecline,
}) => {
  const [secondsRemaining, setSecondsRemaining] = useState(callRingDuration)
  const [hasActioned, setHasActioned] = useState(false)

  useEffect(() => {
    if (hasActioned) return
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          if (!hasActioned) {
            setHasActioned(true)
            sound.stopAllCallTones()
            onDecline()
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [onDecline, hasActioned])

  const handleAccept = () => {
    if (hasActioned) return
    setHasActioned(true)
    sound.stopAllCallTones()
    sound.playKeyClick()
    onAccept()
  }

  const handleDecline = () => {
    if (hasActioned) return
    setHasActioned(true)
    sound.stopAllCallTones()
    sound.playKeyClick()
    onDecline()
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(5, 5, 12, 0.94)',
        backdropFilter: 'blur(4px)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '14px',
        borderRadius: '12px',
        border: '1.5px solid #22c55e66',
        boxShadow: '0 0 24px rgba(34, 197, 94, 0.25)',
        pointerEvents: 'auto',
      }}
    >
      {/* Flashing Ringing Icon */}
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #15803d 0%, #22c55e 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '10px',
          boxShadow: '0 0 16px rgba(34, 197, 94, 0.6)',
          animation: 'ring-pulse 1.4s infinite',
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.09 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
        </svg>
      </div>

      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '8px',
          letterSpacing: '0.12em',
          color: '#22c55e',
          fontWeight: 700,
          marginBottom: '2px',
        }}
      >
        INCOMING VOICE CALL ({secondsRemaining}s)
      </span>

      <span
        style={{
          fontFamily: "'VT323', monospace",
          fontSize: '22px',
          color: '#fff',
          letterSpacing: '0.05em',
          lineHeight: 1.1,
          textAlign: 'center',
        }}
      >
        {caller.name.toUpperCase()}
      </span>

      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '9px',
          color: '#86efac',
          marginBottom: '16px',
        }}
      >
        EXTENSION {caller.ext}
      </span>

      {/* Action Buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '100%' }}>
        <button
          onClick={handleDecline}
          style={{
            padding: '8px',
            borderRadius: '8px',
            background: 'linear-gradient(180deg, #ef4444 0%, #dc2626 100%)',
            border: '1px solid #f87171',
            color: '#fff',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '9px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 0 8px rgba(239, 68, 68, 0.4)',
          }}
        >
          DECLINE
        </button>

        <button
          onClick={handleAccept}
          style={{
            padding: '8px',
            borderRadius: '8px',
            background: 'linear-gradient(180deg, #22c55e 0%, #16a34a 100%)',
            border: '1px solid #86efac',
            color: '#fff',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '9px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 0 10px rgba(34, 197, 94, 0.5)',
          }}
        >
          ANSWER
        </button>
      </div>
    </div>
  )
}
