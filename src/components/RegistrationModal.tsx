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
  { ext: '101', label: '101 (Station 1 / Key 1)' },
  { ext: '102', label: '102 (Station 2 / Key 2)' },
  { ext: '103', label: '103 (Station 3 / Key 3)' },
  { ext: '104', label: '104 (Station 4 / Key 4)' },
  { ext: '105', label: '105 (Station 5 / Key 5)' },
  { ext: '106', label: '106 (Station 6 / Key 6)' },
  { ext: '107', label: '107 (Station 7 / Key 7)' },
  { ext: '108', label: '108 (Station 8 / Key 8)' },
  { ext: '109', label: '109 (Station 9 / Key 9)' },
  { ext: '100', label: '100 (Master / Admin / Reception)' },
]

export const RegistrationModal: React.FC<RegistrationModalProps> = ({
  myProfile,
  occupiedExts = [],
  onCompleteRegistration,
}) => {
  // Available extensions on LAN mesh
  const availableOptions = EXT_OPTIONS.filter(
    (opt) => !occupiedExts.includes(opt.ext) || opt.ext === myProfile.ext
  )

  const [name, setName] = useState(() => {
    if (myProfile.name && myProfile.name !== 'Reception' && myProfile.name !== 'Station') {
      return myProfile.name
    }
    try {
      return localStorage.getItem('opap_user_name') || ''
    } catch {
      return ''
    }
  })

  const [dept, setDept] = useState(() => {
    if (myProfile.full && !myProfile.full.includes('Reception') && !myProfile.full.includes('Station')) {
      return myProfile.full.replace(/ Unit$/i, '').trim()
    }
    try {
      return localStorage.getItem('opap_station_full') || ''
    } catch {
      return ''
    }
  })

  const [selectedExt, setSelectedExt] = useState(() => {
    // Check if saved ext is available
    let savedExt = ''
    try { savedExt = localStorage.getItem('opap_station_ext') || '' } catch {}
    if (savedExt && (!occupiedExts.includes(savedExt) || savedExt === myProfile.ext)) {
      return savedExt
    }

    if (myProfile.ext && (!occupiedExts.includes(myProfile.ext) || myProfile.ext === '101')) {
      return myProfile.ext
    }

    const firstFree = EXT_OPTIONS.find((opt) => !occupiedExts.includes(opt.ext))
    return firstFree ? firstFree.ext : '101'
  })

  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleRegister = (e?: React.FormEvent | React.MouseEvent | React.KeyboardEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault()
    }

    const trimmedName = name.trim()

    // Validate that a non-empty name is entered
    if (!trimmedName) {
      setError('Please enter your name or station identifier')
      sound.playRogerBeep()
      return
    }

    if (trimmedName.toLowerCase() === 'anonymous' || trimmedName.toLowerCase() === 'unknown') {
      setError('Anonymous identity is prohibited on this intercom system')
      sound.playRogerBeep()
      return
    }

    if (!selectedExt) {
      setError('Please select an available extension')
      sound.playRogerBeep()
      return
    }

    setError(null)
    setIsSubmitting(true)
    sound.playKeyClick()

    const finalFull = dept.trim()
      ? (selectedExt === '100' ? `${dept.trim()} (Admin)` : `${dept.trim()} Unit`)
      : (selectedExt === '100' ? `${trimmedName} (Admin)` : `${trimmedName} Unit`)

    console.log('[Registration] Completing registration for:', trimmedName, selectedExt, finalFull)

    try {
      onCompleteRegistration({
        name: trimmedName,
        full: finalFull,
        ext: selectedExt,
        status: 'idle',
      })
    } catch (err) {
      console.error('[Registration] Error calling onCompleteRegistration:', err)
      setIsSubmitting(false)
    }
  }

  return (
    <div
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '10px 10px 8px',
        background: 'radial-gradient(ellipse at 50% 15%, #182236 0%, #0d121c 100%)',
        borderRadius: '10px',
        border: '1.5px solid #2563eb',
        boxShadow: 'inset 0 0 25px rgba(37, 99, 235, 0.22), 0 0 15px rgba(0, 0, 0, 0.6)',
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}
    >
      {/* ── SECURITY ENFORCEMENT BANNER ── */}
      <div
        style={{
          background: 'linear-gradient(180deg, #090e18 0%, #0c1424 100%)',
          borderRadius: '8px',
          border: '1px solid #1d4ed8',
          padding: '8px 10px',
          marginBottom: '8px',
          textAlign: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '2px' }}>
          <span style={{ fontSize: '13px' }}>📟</span>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '10px',
              fontWeight: 800,
              color: '#60a5fa',
              letterSpacing: '0.08em',
              textShadow: '0 0 8px rgba(96, 165, 250, 0.6)',
            }}
          >
            STATION OPERATOR SETUP
          </span>
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '7px',
            color: '#fbbf24',
            fontWeight: 700,
            letterSpacing: '0.06em',
            marginTop: '2px',
          }}
        >
          🔒 ANONYMOUS CALLING DISABLED · ENTER DETAILS TO UNLOCK
        </div>
        <div
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '7.5px',
            color: '#94a3b8',
            marginTop: '3px',
            lineHeight: 1.3,
          }}
        >
          Enter your name & select an extension below to unlock the intercom console.
        </div>
      </div>

      {/* ── REGISTRATION FORM ── */}
      <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, justifyContent: 'center' }}>
        {/* Field 1: Staff / Operator Name */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
            <label
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '7.5px',
                color: '#93c5fd',
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}
            >
              OPERATOR / STAFF NAME: <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '6.5px', color: '#64748b' }}>
              REQUIRED
            </span>
          </div>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRegister(e)
            }}
            placeholder="e.g. Captain Miller, Nurse Jane, Veen"
            maxLength={32}
            style={{
              width: '100%',
              background: '#0a0f1d',
              border: error && !name.trim() ? '1.5px solid #ef4444' : '1px solid #3b82f6',
              borderRadius: '6px',
              padding: '6px 8px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '10px',
              fontWeight: 600,
              color: '#ffffff',
              outline: 'none',
              boxSizing: 'border-box',
              boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.8)',
            }}
          />
        </div>

        {/* Field 2: Department / Station Title */}
        <div>
          <label
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '7.5px',
              color: '#93c5fd',
              display: 'block',
              marginBottom: '2px',
              fontWeight: 600,
            }}
          >
            DEPARTMENT / STATION TITLE: <span style={{ color: '#64748b' }}>(OPTIONAL)</span>
          </label>
          <input
            type="text"
            value={dept}
            onChange={(e) => {
              setDept(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRegister(e)
            }}
            placeholder={name.trim() ? `${name.trim()} Station / Desk` : 'e.g. Operations Desk, Ward 2, Security'}
            maxLength={36}
            style={{
              width: '100%',
              background: '#0a0f1d',
              border: '1px solid #1e3a8a',
              borderRadius: '6px',
              padding: '5px 8px',
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: '9.5px',
              color: '#cbd5e1',
              outline: 'none',
              boxSizing: 'border-box',
              boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.8)',
            }}
          />
        </div>

        {/* Field 3: Extension Selection */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
            <label
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '7.5px',
                color: '#93c5fd',
                fontWeight: 700,
              }}
            >
              ASSIGNED DIALER EXTENSION: <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '7px',
                color: '#22c55e',
                fontWeight: 700,
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
              background: '#0a0f1d',
              border: '1px solid #2563eb',
              borderRadius: '6px',
              padding: '6px 8px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '9.5px',
              fontWeight: 600,
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
                  <option key={opt.ext} value={opt.ext} style={{ background: '#090e18', color: '#22c55e' }}>
                    {opt.label} {isCurrent ? '(This PC)' : ''}
                  </option>
                )
              })
            ) : (
              <option value="" disabled style={{ background: '#090e18', color: '#ef4444' }}>
                All extensions 100-109 occupied on LAN mesh
              </option>
            )}
          </select>
        </div>

        {/* Error Notice */}
        {error && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #ef4444',
              borderRadius: '5px',
              padding: '5px 8px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '8px',
              color: '#fca5a5',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Submit / Activate Button */}
        <button
          type="button"
          onClick={handleRegister}
          disabled={isSubmitting}
          style={{
            marginTop: '6px',
            background: isSubmitting
              ? '#1e3a8a'
              : 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
            border: '1px solid #60a5fa',
            borderRadius: '7px',
            padding: '9px 12px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '9.5px',
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '0.07em',
            cursor: isSubmitting ? 'wait' : 'pointer',
            boxShadow: '0 0 15px rgba(37, 99, 235, 0.6), inset 0 1px 0 rgba(255,255,255,0.3)',
            transition: 'all 0.15s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            userSelect: 'none',
          }}
        >
          <span>{isSubmitting ? 'CONNECTING STATION...' : 'ACTIVATE STATION & UNLOCK DASHBOARD'}</span>
          <span>➔</span>
        </button>
      </form>

      {/* Footer System Notice */}
      <div
        style={{
          marginTop: '6px',
          textAlign: 'center',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '6.5px',
          color: '#475569',
          letterSpacing: '0.04em',
        }}
      >
        OPAP SECURE P2P INTERCOM · VERIFIED IDENTITY REQUIRED
      </div>
    </div>
  )
}
