import React, { useState } from 'react'
import { Peer, Status } from '../types/opap'
import { sound } from '../services/soundSynthesizer'

interface RegistrationModalProps {
  myProfile: Peer
  occupiedExts: string[]
  masterPin?: string
  onCompleteRegistration: (profile: { name: string; full: string; ext: string; status: Status }) => void
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

export const RegistrationModal: React.FC<RegistrationModalProps> = ({
  myProfile,
  occupiedExts,
  masterPin = '1234',
  onCompleteRegistration,
}) => {
  // Strictly filter out all in-use extensions on the LAN to prevent conflict!
  const availableOptions = EXT_OPTIONS.filter(
    (opt) => !occupiedExts.includes(opt.ext) || opt.ext === myProfile.ext
  )

  const [name, setName] = useState(myProfile.name === 'Reception' ? '' : myProfile.name)
  const [pin, setPin] = useState('')
  const [selectedExt, setSelectedExt] = useState(() => {
    // If current station ext is valid & available, preserve it
    const isCurrentValid = myProfile.ext && (!occupiedExts.includes(myProfile.ext) || myProfile.ext === '100')
    if (isCurrentValid) return myProfile.ext

    // Otherwise, automatically select the first genuinely available extension
    const firstFree = EXT_OPTIONS.find((opt) => !occupiedExts.includes(opt.ext))
    return firstFree ? firstFree.ext : '101'
  })
  const [error, setError] = useState<string | null>(null)

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Please enter your name or role')
      sound.playRogerBeep()
      return
    }

    if (!selectedExt) {
      setError('No available extension selected')
      sound.playRogerBeep()
      return
    }

    // If registering as EXT 100 (Admin / Master), require PIN code
    if (selectedExt === '100') {
      if (pin.trim() !== masterPin.trim()) {
        setError(`Invalid Master PIN for EXT 100. (Default: 1234)`)
        sound.playDisconnectTone()
        return
      }
    }

    sound.playKeyClick()
    onCompleteRegistration({
      name: trimmedName,
      full: selectedExt === '100' ? `${trimmedName} (Admin)` : `${trimmedName} Unit`,
      ext: selectedExt,
      status: 'idle',
    })
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(7, 7, 14, 0.98)',
        backdropFilter: 'blur(8px)',
        zIndex: 150,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '16px 14px',
        borderRadius: '14px',
        border: '1.5px solid #3b82f6',
        boxShadow: '0 0 30px rgba(59, 130, 246, 0.35)',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '20px', marginBottom: '2px' }}>📟</div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '11px',
            fontWeight: 700,
            color: '#60a5fa',
            letterSpacing: '0.08em',
          }}
        >
          UNIT SELF-REGISTRATION
        </div>
        <div
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '8px',
            color: '#94a3b8',
            marginTop: '2px',
          }}
        >
          Assign your Name & Available Extension to join Intercom
        </div>
      </div>

      <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Staff Name Input */}
        <div>
          <label
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '7.5px',
              color: '#93c5fd',
              display: 'block',
              marginBottom: '3px',
              fontWeight: 600,
            }}
          >
            STAFF / STATION NAME:
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
            placeholder="e.g. Sarah, James, Reception, Lab 1"
            style={{
              width: '100%',
              background: '#131b2e',
              border: error ? '1px solid #ef4444' : '1px solid #2563eb',
              borderRadius: '6px',
              padding: '6px 8px',
              fontFamily: 'Inter, sans-serif',
              fontSize: '10px',
              color: '#ffffff',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {error && (
            <span style={{ fontSize: '7.5px', color: '#ef4444', marginTop: '2px', display: 'block' }}>
              {error}
            </span>
          )}
        </div>

        {/* Extension Assignment Selection (Only Available Extensions Shown) */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
            <label
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '7.5px',
                color: '#93c5fd',
                fontWeight: 600,
              }}
            >
              SELECT DIALER EXTENSION:
            </label>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '7px',
                color: '#22c55e',
                fontWeight: 600,
              }}
            >
              {availableOptions.length} AVAILABLE
            </span>
          </div>

          <select
            value={selectedExt}
            onChange={(e) => setSelectedExt(e.target.value)}
            disabled={availableOptions.length === 0}
            style={{
              width: '100%',
              background: '#131b2e',
              border: '1px solid #2563eb',
              borderRadius: '6px',
              padding: '6px 8px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '9px',
              color: '#22c55e',
              outline: 'none',
              cursor: 'pointer',
              boxSizing: 'border-box',
            }}
          >
            {availableOptions.length > 0 ? (
              availableOptions.map((opt) => {
                const isCurrent = opt.ext === myProfile.ext
                return (
                  <option key={opt.ext} value={opt.ext} style={{ background: '#0f172a', color: '#22c55e' }}>
                    {opt.label} {isCurrent ? '(Current Station)' : '(Available)'}
                  </option>
                )
              })
            ) : (
              <option value="" disabled style={{ background: '#0f172a', color: '#ef4444' }}>
                All extensions 100-109 currently in use on LAN
              </option>
            )}
          </select>
        </div>

        {/* Master Admin PIN Code Prompt when EXT 100 is selected */}
        {selectedExt === '100' && (
          <div
            style={{
              background: '#1e293b',
              border: '1px solid #f59e0b',
              borderRadius: '8px',
              padding: '6px 8px',
              animation: 'pulse-dot 0.3s ease-out',
            }}
          >
            <label
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '7.5px',
                color: '#f59e0b',
                display: 'block',
                marginBottom: '3px',
                fontWeight: 700,
              }}
            >
              🔐 ADMIN PIN CODE REQUIRED (Default: 1234):
            </label>
            <input
              type="password"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value)
                if (error) setError(null)
              }}
              placeholder="Enter 4-digit PIN..."
              maxLength={6}
              autoFocus
              style={{
                width: '100%',
                background: '#0f172a',
                border: error && error.includes('PIN') ? '1px solid #ef4444' : '1px solid #f59e0b88',
                borderRadius: '5px',
                padding: '5px 8px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '11px',
                color: '#f59e0b',
                letterSpacing: '0.2em',
                outline: 'none',
                boxSizing: 'border-box',
                textAlign: 'center',
              }}
            />
          </div>
        )}

        {/* Action Button */}
        <button
          type="submit"
          style={{
            marginTop: '8px',
            background: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
            border: '1px solid #60a5fa',
            borderRadius: '8px',
            padding: '8px 12px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '9px',
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '0.06em',
            cursor: 'pointer',
            boxShadow: '0 0 12px rgba(37, 99, 235, 0.5)',
            transition: 'all 0.15s ease',
          }}
        >
          INITIALIZE & JOIN INTERCOM ➔
        </button>
      </form>
    </div>
  )
}
