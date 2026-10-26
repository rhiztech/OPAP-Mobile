import React from 'react'
import { Peer, CallSignal } from '../types/opap'
import { sound } from '../services/soundSynthesizer'

interface CallWaitingModalProps {
  caller: Peer
  signal: CallSignal
  onHoldAndAnswer: () => void
  onEndAndAnswer: () => void
  onDecline: () => void
}

export const CallWaitingModal: React.FC<CallWaitingModalProps> = ({
  caller,
  onHoldAndAnswer,
  onEndAndAnswer,
  onDecline,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(8, 6, 18, 0.94)',
        backdropFilter: 'blur(6px)',
        zIndex: 120,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.2s ease-out',
      }}
    >
      {/* Call Waiting Pulsing Header Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'rgba(245, 158, 11, 0.2)',
          border: '1px solid rgba(245, 158, 11, 0.6)',
          borderRadius: '20px',
          padding: '4px 12px',
          marginBottom: '12px',
        }}
      >
        <span style={{ fontSize: '10px', animation: 'pulse-dot 1s infinite' }}>🔔</span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '9px',
            fontWeight: 800,
            color: '#fbbf24',
            letterSpacing: '0.08em',
          }}
        >
          CALL WAITING (GSM)
        </span>
      </div>

      {/* Caller Avatar / Icon */}
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
          border: '2px solid #fbbf24',
          boxShadow: '0 0 16px rgba(245, 158, 11, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '8px',
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '18px',
            fontWeight: 800,
            color: '#ffffff',
          }}
        >
          {caller.name.slice(0, 2).toUpperCase()}
        </span>
      </div>

      {/* Caller Details */}
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '14px',
          fontWeight: 800,
          color: '#ffffff',
          marginBottom: '2px',
          textAlign: 'center',
        }}
      >
        {caller.name.toUpperCase()}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '10px',
          fontWeight: 700,
          color: '#fbbf24',
          marginBottom: '16px',
          letterSpacing: '0.06em',
        }}
      >
        EXT {caller.ext} IS CALLING YOU...
      </div>

      {/* 3 Action Buttons (GSM Telephony Standard) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          width: '100%',
          maxWidth: '220px',
        }}
      >
        {/* 1. HOLD & ANSWER (Swap) */}
        <button
          type="button"
          onClick={() => {
            sound.playKeyClick()
            onHoldAndAnswer()
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '8px 12px',
            borderRadius: '8px',
            cursor: 'pointer',
            border: '1.5px solid #22c55e',
            background: 'linear-gradient(180deg, #16a34a 0%, #15803d 100%)',
            boxShadow: '0 2px 10px rgba(34,197,94,0.4)',
            color: '#ffffff',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '9.5px',
            fontWeight: 800,
            letterSpacing: '0.05em',
            transition: 'all 0.15s ease',
            outline: 'none',
          }}
        >
          <span>⏸️</span>
          <span>HOLD & ANSWER</span>
        </button>

        {/* 2. END & ANSWER */}
        <button
          type="button"
          onClick={() => {
            sound.playKeyClick()
            onEndAndAnswer()
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '8px 12px',
            borderRadius: '8px',
            cursor: 'pointer',
            border: '1.5px solid #f59e0b',
            background: 'linear-gradient(180deg, #d97706 0%, #b45309 100%)',
            boxShadow: '0 2px 10px rgba(245,158,11,0.3)',
            color: '#ffffff',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '9.5px',
            fontWeight: 800,
            letterSpacing: '0.05em',
            transition: 'all 0.15s ease',
            outline: 'none',
          }}
        >
          <span>🔴</span>
          <span>END & ANSWER</span>
        </button>

        {/* 3. DECLINE */}
        <button
          type="button"
          onClick={() => {
            sound.playKeyClick()
            onDecline()
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '8px 12px',
            borderRadius: '8px',
            cursor: 'pointer',
            border: '1.5px solid #ef4444',
            background: 'rgba(239, 68, 68, 0.15)',
            color: '#f87171',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '9.5px',
            fontWeight: 700,
            letterSpacing: '0.05em',
            transition: 'all 0.15s ease',
            outline: 'none',
          }}
        >
          <span>✖</span>
          <span>DECLINE</span>
        </button>
      </div>
    </div>
  )
}
