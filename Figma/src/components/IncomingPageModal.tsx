import React, { useState, useEffect } from 'react'
import { Peer, CallSignal } from '../types/opap'
import { sound } from '../services/soundSynthesizer'

interface IncomingPageModalProps {
  caller: Peer
  signal: CallSignal
  pageToneDuration?: number | 'continuous'
  onAcknowledge: (text: string) => void
  onDecline: (text: string) => void
  onDismiss: () => void
}

const QUICK_RESPONSES = ['On my way', 'Busy / in meeting', 'Will call back']

export const IncomingPageModal: React.FC<IncomingPageModalProps> = ({
  caller,
  pageToneDuration = 15,
  onAcknowledge,
  onDecline,
  onDismiss,
}) => {
  const isContinuous = pageToneDuration === 'continuous'
  const initialSecs = typeof pageToneDuration === 'number' ? pageToneDuration : 15
  const [secondsRemaining, setSecondsRemaining] = useState(initialSecs)
  const [replyText, setReplyText] = useState('')

  useEffect(() => {
    if (isContinuous) return

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          onDismiss()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [isContinuous, onDismiss])

  const handleAckClick = () => {
    sound.playKeyClick()
    onAcknowledge(replyText.trim())
  }

  const handleDeclineClick = () => {
    sound.playKeyClick()
    onDecline(replyText.trim())
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(8, 6, 18, 0.96)',
        backdropFilter: 'blur(6px)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 12px 10px',
        borderRadius: '12px',
        border: '1.5px solid #f59e0b88',
        boxShadow: '0 0 28px rgba(245, 158, 11, 0.35)',
        boxSizing: 'border-box',
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
    >
      {/* Top: Flashing Icon & Identity */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '4px',
            boxShadow: '0 0 16px rgba(245, 158, 11, 0.7)',
            animation: 'ring-pulse 0.8s infinite',
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
          </svg>
        </div>

        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '8px',
            letterSpacing: '0.12em',
            color: '#f59e0b',
            fontWeight: 700,
            marginBottom: '1px',
          }}
        >
          🚨 INCOMING PAGER ALERT {isContinuous ? '(CONTINUOUS)' : `(${secondsRemaining}s)`}
        </span>

        <span
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '18px',
            color: '#ffffff',
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
            fontSize: '7.5px',
            color: '#fde68a',
          }}
        >
          EXT {caller.ext} · BEEPING
        </span>
      </div>

      {/* Middle: Textarea for custom input + quick chips */}
      <div style={{ width: '100%', margin: '4px 0' }}>
        {/* Quick reply chips */}
        <div style={{ display: 'flex', gap: '3px', marginBottom: '4px', overflowX: 'auto', paddingBottom: '2px' }}>
          {QUICK_RESPONSES.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => {
                sound.playKeyClick()
                setReplyText(chip)
              }}
              style={{
                background: '#19192b',
                border: '1px solid #3d3d5c',
                borderRadius: '4px',
                padding: '2px 5px',
                fontSize: '7px',
                color: '#cbd5e1',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontFamily: "'JetBrains Mono', monospace",
                lineHeight: 1.2,
              }}
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Custom Text Area */}
        <textarea
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Custom reply note (optional)..."
          rows={2}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: '#10101c',
            border: '1px solid #393952',
            borderRadius: '6px',
            padding: '4px 6px',
            fontSize: '8.5px',
            color: '#ffffff',
            fontFamily: "'JetBrains Mono', monospace",
            resize: 'none',
            outline: 'none',
          }}
        />
      </div>

      {/* Bottom: ACKNOWLEDGE and DECLINE Action Buttons */}
      <div style={{ display: 'flex', gap: '6px', width: '100%' }}>
        {/* 1. ACKNOWLEDGE BUTTON (Green) */}
        <button
          type="button"
          onClick={handleAckClick}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3px',
            padding: '7px 4px',
            background: 'linear-gradient(180deg, #16a34a 0%, #15803d 100%)',
            border: '1.5px solid #4ade80',
            borderRadius: '7px',
            color: '#ffffff',
            cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '8.5px',
            fontWeight: 700,
            boxShadow: '0 0 10px rgba(34, 197, 94, 0.4)',
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ffffff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          ACKNOWLEDGE
        </button>

        {/* 2. DECLINE BUTTON (Red) */}
        <button
          type="button"
          onClick={handleDeclineClick}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3px',
            padding: '7px 4px',
            background: 'linear-gradient(180deg, #dc2626 0%, #991b1b 100%)',
            border: '1.5px solid #f87171',
            borderRadius: '7px',
            color: '#ffffff',
            cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '8.5px',
            fontWeight: 700,
            boxShadow: '0 0 10px rgba(239, 68, 68, 0.4)',
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ffffff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          DECLINE
        </button>
      </div>
    </div>
  )
}
