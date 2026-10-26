import React, { useState, useEffect } from 'react'
import { sound } from '../services/soundSynthesizer'

interface BroadcastModalProps {
  onBroadcast: (text: string) => void
  onClose: () => void
}

const DEFAULT_PRESETS = [
  'All-Hands meeting starting now in Room 2A',
  'Visitor waiting at Reception desk',
  'Courier package ready for collection',
  'Scheduled fire alarm test in 5 minutes',
  'Lunch catering has arrived in canteen',
]

const STORAGE_KEY = 'opap_broadcast_presets_v1'

export const BroadcastModal: React.FC<BroadcastModalProps> = ({ onBroadcast, onClose }) => {
  const [presets, setPresets] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {
      // fallback
    }
    return DEFAULT_PRESETS
  })

  const [text, setText] = useState('')
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [newPresetText, setNewPresetText] = useState('')
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  // Save presets to localStorage whenever updated
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
    } catch {
      // ignore
    }
  }, [presets])

  const handleTransmit = (customText?: string) => {
    const msg = (customText ?? text).trim()
    if (!msg) return
    sound.playKeyClick()
    onBroadcast(msg)
    onClose()
  }

  const handleStartEdit = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation()
    sound.playKeyClick()
    setEditingIdx(idx)
    setEditText(presets[idx] || '')
  }

  const handleSaveEdit = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation()
    sound.playKeyClick()
    const trimmed = editText.trim()
    if (trimmed) {
      setPresets((prev) => {
        const next = [...prev]
        next[idx] = trimmed
        return next
      })
    }
    setEditingIdx(null)
  }

  const handleDeletePreset = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation()
    sound.playKeyClick()
    setPresets((prev) => prev.filter((_, i) => i !== idx))
    if (editingIdx === idx) setEditingIdx(null)
  }

  const handleAddPreset = () => {
    const trimmed = newPresetText.trim()
    if (!trimmed) return
    sound.playKeyClick()
    setPresets((prev) => [...prev, trimmed])
    setNewPresetText('')
    setIsAdding(false)
  }

  const handleResetDefaults = (e: React.MouseEvent) => {
    e.stopPropagation()
    sound.playKeyClick()
    setPresets(DEFAULT_PRESETS)
    setEditingIdx(null)
    setIsAdding(false)
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(8, 8, 16, 0.97)',
        backdropFilter: 'blur(8px)',
        zIndex: 110,
        display: 'flex',
        flexDirection: 'column',
        padding: '11px',
        borderRadius: '10px',
        border: '1.5px solid #f59e0b88',
        boxShadow: '0 0 28px rgba(245, 158, 11, 0.3)',
        boxSizing: 'border-box',
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '15px' }}>📢</span>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '11px',
              letterSpacing: '0.08em',
              color: '#f59e0b',
              fontWeight: 800,
            }}
          >
            OFFICE PA BROADCAST
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={handleResetDefaults}
            title="Reset to default preset announcements"
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: '7.5px',
              fontFamily: 'Inter, sans-serif',
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
            }}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '16px',
              fontWeight: 700,
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      </div>

      <p
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: '8.5px',
          color: '#94a3b8',
          margin: '0 0 7px 0',
          lineHeight: 1.3,
        }}
      >
        Transmits audio chime & ticker alert to all online LAN units.
      </p>

      {/* Presets List */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '5px',
          overflowY: 'auto',
          marginBottom: '8px',
          paddingRight: '2px',
        }}
      >
        {presets.map((preset, idx) => {
          const isEditing = editingIdx === idx

          if (isEditing) {
            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: '#1e293b',
                  border: '1px solid #f59e0b',
                  borderRadius: '6px',
                  padding: '4px 6px',
                  boxSizing: 'border-box',
                }}
              >
                <input
                  type="text"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit(idx, e as unknown as React.MouseEvent)}
                  autoFocus
                  style={{
                    flex: 1,
                    background: '#0f172a',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    padding: '3px 6px',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '9.5px',
                    fontWeight: 600,
                    color: '#fff',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={(e) => handleSaveEdit(idx, e)}
                  title="Save edit"
                  style={{
                    background: '#16a34a',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#fff',
                    fontSize: '9px',
                    fontWeight: 700,
                    padding: '3px 6px',
                    cursor: 'pointer',
                  }}
                >
                  ✓
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDeletePreset(idx, e)}
                  title="Delete preset"
                  style={{
                    background: '#dc2626',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#fff',
                    fontSize: '9px',
                    fontWeight: 700,
                    padding: '3px 6px',
                    cursor: 'pointer',
                  }}
                >
                  🗑️
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingIdx(null)
                  }}
                  title="Cancel edit"
                  style={{
                    background: '#475569',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#fff',
                    fontSize: '9px',
                    fontWeight: 700,
                    padding: '3px 6px',
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </div>
            )
          }

          const isHovered = hoveredIdx === idx

          return (
            <div
              key={idx}
              onClick={() => handleTransmit(preset)}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              title="Click to broadcast this announcement immediately"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 8px',
                borderRadius: '6px',
                background: isHovered
                  ? 'linear-gradient(180deg, #27354a 0%, #1a2638 100%)'
                  : 'linear-gradient(180deg, #1e293b 0%, #151f30 100%)',
                border: isHovered ? '1px solid #475569' : '1px solid #334155',
                cursor: 'pointer',
                boxSizing: 'border-box',
                transition: 'all 0.12s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', flex: 1 }}>
                <span style={{ color: '#f59e0b', fontSize: '9px', fontWeight: 800 }}>•</span>
                <span
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '9.5px',
                    fontWeight: 600,
                    color: isHovered ? '#ffffff' : '#f8fafc',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: 1.2,
                  }}
                >
                  {preset}
                </span>
              </div>

              {/* Edit button - only visible on hover */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginLeft: '6px',
                  flexShrink: 0,
                  opacity: isHovered ? 1 : 0,
                  pointerEvents: isHovered ? 'auto' : 'none',
                  transition: 'opacity 0.15s ease',
                }}
              >
                <button
                  type="button"
                  onClick={(e) => handleStartEdit(idx, e)}
                  title="Edit or rename this preset"
                  style={{
                    background: '#334155',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    color: '#f1f5f9',
                    fontSize: '9px',
                    padding: '2px 5px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                  }}
                >
                  ✏️
                </button>
              </div>
            </div>
          )
        })}

        {/* Add Preset Form */}
        {isAdding ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: '#1e293b',
              border: '1px dashed #f59e0b',
              borderRadius: '6px',
              padding: '4px 6px',
              boxSizing: 'border-box',
            }}
          >
            <input
              type="text"
              value={newPresetText}
              onChange={(e) => setNewPresetText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddPreset()}
              placeholder="Enter new preset text..."
              autoFocus
              style={{
                flex: 1,
                background: '#0f172a',
                border: '1px solid #475569',
                borderRadius: '4px',
                padding: '3px 6px',
                fontFamily: 'Inter, sans-serif',
                fontSize: '9.5px',
                fontWeight: 600,
                color: '#fff',
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={handleAddPreset}
              disabled={!newPresetText.trim()}
              style={{
                background: newPresetText.trim() ? '#16a34a' : '#475569',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '9px',
                fontWeight: 700,
                padding: '3px 6px',
                cursor: newPresetText.trim() ? 'pointer' : 'default',
              }}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAdding(false)
                setNewPresetText('')
              }}
              style={{
                background: '#475569',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '9px',
                fontWeight: 700,
                padding: '3px 6px',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              sound.playKeyClick()
              setIsAdding(true)
            }}
            style={{
              background: 'transparent',
              border: '1px dashed #334155',
              borderRadius: '6px',
              color: '#94a3b8',
              fontFamily: 'Inter, sans-serif',
              fontSize: '8.5px',
              fontWeight: 600,
              padding: '4px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              transition: 'all 0.12s ease',
            }}
          >
            <span>+</span>
            <span>Add Custom Announcement Preset</span>
          </button>
        )}
      </div>

      {/* Custom Input Bar */}
      <div style={{ display: 'flex', gap: '6px', marginTop: 'auto' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleTransmit()}
          placeholder="Custom announcement text..."
          style={{
            flex: 1,
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '6px',
            padding: '6px 8px',
            fontFamily: 'Inter, sans-serif',
            fontSize: '9.5px',
            color: '#fff',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <button
          type="button"
          onClick={() => handleTransmit()}
          disabled={!text.trim()}
          style={{
            background: text.trim()
              ? 'linear-gradient(180deg, #f59e0b 0%, #d97706 100%)'
              : '#334155',
            border: 'none',
            borderRadius: '6px',
            padding: '6px 14px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '9px',
            fontWeight: 800,
            color: '#fff',
            cursor: text.trim() ? 'pointer' : 'default',
            boxShadow: text.trim() ? '0 2px 8px rgba(245,158,11,0.45)' : 'none',
            transition: 'all 0.15s ease',
            flexShrink: 0,
          }}
        >
          PAGE
        </button>
      </div>
    </div>
  )
}
