import React, { useState, useRef, useEffect } from 'react'
import { Peer, Message, Status, BroadcastAnnouncement, CallState } from '../types/opap'
import { sound } from '../services/soundSynthesizer'

interface ChatPanelProps {
  isOpen?: boolean
  peers: Peer[]
  myProfile: Peer
  selectedPeer: Peer | null
  chats: Record<string, Message[]>
  broadcastHistory: BroadcastAnnouncement[]
  callState?: CallState
  onSelectPeer: (peer: Peer) => void
  onSendMessage: (targetPeer: Peer, text: string, audioData?: string) => void
  onCallPeer: (peer: Peer) => void
  onEndCall?: () => void
  onClearRoomChat: (peer: Peer) => void
  onClearBroadcastHistory: () => void
  onDeleteSingleMessage: (msgId: string) => void
  onClose: () => void
  onOpenBroadcast: () => void
}

const QUICK_REPLIES = ['On my way!', 'In a meeting', 'Back in 5', 'Call me?', 'Roger that! 👍']

const STATUS_COLOR: Record<Status, string> = {
  idle: '#22c55e',
  busy: '#f59e0b',
  away: '#6b7280',
  dnd: '#ef4444',
}

function isDifferentDay(t1?: number, t2?: number): boolean {
  if (!t1 || !t2) return false
  const d1 = new Date(t1)
  const d2 = new Date(t2)
  return d1.toDateString() !== d2.toDateString()
}

function fmtDateHeader(t?: number): string {
  if (!t) return 'RECENT'
  const d = new Date(t)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'TODAY'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'YESTERDAY'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()
}

const TrashIcon = ({ size = 11, color = '#ef4444' }: { size?: number; color?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
)

export const ChatPanel: React.FC<ChatPanelProps> = ({
  isOpen = false,
  peers,
  myProfile,
  selectedPeer,
  chats,
  broadcastHistory,
  callState,
  onSelectPeer,
  onSendMessage,
  onCallPeer,
  onEndCall,
  onClearRoomChat,
  onClearBroadcastHistory,
  onDeleteSingleMessage,
  onClose,
  onOpenBroadcast,
}) => {
  // Always default to 'rooms' list view (never auto-open a room without user click)
  const [viewMode, setViewMode] = useState<'rooms' | 'chat'>('rooms')
  const [activeRoomPeer, setActiveRoomPeer] = useState<Peer | null>(null)
  const [inputText, setInputText] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null)
  const [broadcastRoomActive, setBroadcastRoomActive] = useState(false)

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // Helper to get merged, deduplicated messages for any peer
  const getRoomMessages = (peer: Peer | null): Message[] => {
    if (!peer) return []
    const byId = chats[peer.id] || []
    const byExt = chats[peer.ext] || []
    const byExtAlt = chats[`ext-${peer.ext}`] || []
    const map = new Map<string, Message>()
    ;[...byId, ...byExt, ...byExtAlt].forEach((m) => {
      map.set(m.id, m)
    })
    return Array.from(map.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
  }

  // Build room list for all 9 dialer slots
  const allSlots = Array.from({ length: 9 }, (_, index) => {
    const slotNum = index + 1
    const targetExt = `10${slotNum}`
    const isMe = myProfile.ext === targetExt
    const matchedPeer = !isMe
      ? peers.find((p) => p.ext === targetExt || p.ext === String(slotNum)) || null
      : null

    const peerObj: Peer = matchedPeer || {
      id: isMe ? myProfile.id : `ext-${targetExt}`,
      name: isMe ? `${myProfile.name} (YOU)` : `EXT ${targetExt}`,
      full: isMe ? myProfile.full : `Unassigned Unit ${targetExt}`,
      ext: targetExt,
      status: isMe ? myProfile.status : matchedPeer ? matchedPeer.status : 'away',
      lastSeen: isMe ? Date.now() : matchedPeer ? matchedPeer.lastSeen : 0,
      isLocal: isMe,
    }

    const roomMessages = getRoomMessages(peerObj)
    const lastMsg = roomMessages[roomMessages.length - 1] || null

    return {
      slotNum,
      targetExt,
      peer: peerObj,
      isMe,
      isRegistered: Boolean(matchedPeer),
      messages: roomMessages,
      lastMsg,
      hasMessages: roomMessages.length > 0,
    }
  })

  // Filter: DO NOT SHOW SELF in room list (!slot.isMe), and only show rooms with history or active peers
  const activeChatRooms = allSlots.filter((slot) => !slot.isMe && (slot.hasMessages || slot.isRegistered))

  // Get active chat messages
  const currentMessages: Message[] = activeRoomPeer ? getRoomMessages(activeRoomPeer) : []

  // Smart scroll management: track whether user is at bottom so scrolling history is never interrupted
  const isNearBottomRef = useRef<boolean>(true)
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false)
  const prevRoomKeyRef = useRef<string | null>(null)

  const scrollToBottom = (smooth = true) => {
    if (messagesContainerRef.current) {
      if (smooth) {
        messagesContainerRef.current.scrollTo({
          top: messagesContainerRef.current.scrollHeight,
          behavior: 'smooth',
        })
      } else {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
      }
      isNearBottomRef.current = true
      setShowScrollBottomBtn(false)
    }
  }

  const handleScrollMessages = () => {
    const el = messagesContainerRef.current
    if (!el) return
    // If user is within 45px of bottom, consider them at bottom
    const isNear = el.scrollHeight - el.scrollTop - el.clientHeight <= 45
    isNearBottomRef.current = isNear
    setShowScrollBottomBtn(!isNear)
  }

  // Auto-scroll messages container: ONLY scroll if user is already at the bottom or just entered the room
  useEffect(() => {
    const currentRoomKey = broadcastRoomActive ? 'broadcast' : activeRoomPeer ? activeRoomPeer.id : null
    const roomChanged = currentRoomKey !== prevRoomKeyRef.current
    prevRoomKeyRef.current = currentRoomKey

    if (messagesContainerRef.current) {
      if (roomChanged) {
        // Reset and scroll to bottom when opening a room initially
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
        isNearBottomRef.current = true
        setShowScrollBottomBtn(false)
      } else if (isNearBottomRef.current) {
        // If user is already near bottom, scroll down to show new incoming message
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
      }
      // If user has scrolled up to read chat history, DO NOT interrupt their scrolling!
    }
  }, [currentMessages, broadcastHistory, viewMode, broadcastRoomActive, activeRoomPeer])

  // Automatically mark unread messages as read ONLY when chat panel is OPEN and user is inside that room
  useEffect(() => {
    if (isOpen && viewMode === 'chat' && activeRoomPeer && !broadcastRoomActive) {
      onSelectPeer(activeRoomPeer)
    }
  }, [isOpen, currentMessages.length, viewMode, activeRoomPeer, broadcastRoomActive, onSelectPeer])

  // Explicit user click to open a chat room (only if not self)
  const handleOpenRoom = (peer: Peer) => {
    if (peer.id === myProfile.id || peer.ext === myProfile.ext) return
    sound.playKeyClick()
    setActiveRoomPeer(peer)
    onSelectPeer(peer)
    setBroadcastRoomActive(false)
    setViewMode('chat')
  }

  // Explicit user click to open broadcast channel
  const handleOpenBroadcastRoom = () => {
    sound.playKeyClick()
    setBroadcastRoomActive(true)
    setViewMode('chat')
  }

  // Back button to return to rooms list
  const handleBackToRooms = () => {
    sound.playKeyClick()
    setViewMode('rooms')
    setBroadcastRoomActive(false)
  }

  const handleSend = (textToSend?: string) => {
    const text = (textToSend ?? inputText).trim()
    if (!text || !activeRoomPeer) return
    if (activeRoomPeer.id === myProfile.id || activeRoomPeer.ext === myProfile.ext) return
    onSendMessage(activeRoomPeer, text)
    setInputText('')
    setTimeout(() => scrollToBottom(false), 50)
  }

  // Voice Note Recorder
  const startVoiceRecording = async () => {
    try {
      sound.playKeyClick()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []
      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data)
        }
      }

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const reader = new FileReader()
        reader.onloadend = () => {
          const base64Audio = reader.result as string
          if (activeRoomPeer && activeRoomPeer.id !== myProfile.id) {
            onSendMessage(activeRoomPeer, '🎤 Voice Note (0:04)', base64Audio)
          }
        }
        reader.readAsDataURL(audioBlob)
        stream.getTracks().forEach((t) => t.stop())
        setIsRecording(false)
      }

      recorder.start()
      setIsRecording(true)
    } catch {
      sound.playRogerBeep()
      setIsRecording(true)
      setTimeout(() => {
        setIsRecording(false)
        if (activeRoomPeer && activeRoomPeer.id !== myProfile.id) {
          onSendMessage(activeRoomPeer, '🎤 Voice Note (0:03)')
        }
      }, 1500)
    }
  }

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      sound.playRogerBeep()
      mediaRecorderRef.current.stop()
    } else {
      setIsRecording(false)
    }
  }

  const playVoiceNote = (msgId: string, audioData?: string) => {
    sound.playKeyClick()
    if (audioData) {
      const audio = new Audio(audioData)
      setPlayingAudioId(msgId)
      audio.onended = () => setPlayingAudioId(null)
      audio.play().catch(() => setPlayingAudioId(null))
    } else {
      setPlayingAudioId(msgId)
      sound.playRogerBeep()
      setTimeout(() => setPlayingAudioId(null), 1800)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'linear-gradient(180deg, #11111c 0%, #0c0c16 100%)',
        borderRadius: '8px',
        border: '1.5px solid #282845',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 24px rgba(0,0,0,0.85)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* ─────────────────────────────────────────────────────────────
          VIEW 1: WHATSAPP-STYLE MSG ROOMS LIST
      ───────────────────────────────────────────────────────────── */}
      {viewMode === 'rooms' ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Header Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px',
              background: '#161626',
              borderBottom: '1px solid #282840',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ fontSize: '12px' }}>💬</span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '9.5px',
                  fontWeight: 700,
                  color: '#60a5fa',
                  letterSpacing: '0.06em',
                }}
              >
                MSG CHAT ROOMS
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <button
                type="button"
                onClick={onOpenBroadcast}
                style={{
                  background: '#1e3a8a',
                  border: '1px solid #3b82f6',
                  borderRadius: '4px',
                  padding: '2px 5px',
                  fontSize: '7.5px',
                  color: '#93c5fd',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
                title="Send All-Station PA Announcement"
              >
                📢 PA
              </button>

              <button
                type="button"
                onClick={onClose}
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: 'linear-gradient(180deg, #ef4444 0%, #dc2626 100%)',
                  border: '1.2px solid #fca5a5',
                  color: '#ffffff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 8px rgba(239, 68, 68, 0.55), inset 0 1px 0 rgba(255,255,255,0.4)',
                  padding: 0,
                  outline: 'none',
                  flexShrink: 0,
                  transition: 'transform 0.1s ease, box-shadow 0.1s ease',
                }}
                title="Close messages"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Rooms Scrollable List: Only Active Previous/New Chats & Available Units (Self Excluded) */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              scrollbarWidth: 'none',
              padding: '4px 6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {/* 1. All-Station Broadcast Channel */}
            <div
              onClick={handleOpenBroadcastRoom}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 8px',
                background: 'linear-gradient(180deg, #1b2234 0%, #131724 100%)',
                borderRadius: '6px',
                border: '1px solid #2b3a58',
                cursor: 'pointer',
                transition: 'all 0.1s ease',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: '#1d4ed8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  boxShadow: '0 0 8px rgba(37,99,235,0.4)',
                  flexShrink: 0,
                }}
              >
                📢
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '8.5px',
                      fontWeight: 700,
                      color: '#93c5fd',
                    }}
                  >
                    ALL-STATION PA CHANNEL
                  </span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '6.5px', color: '#64748b' }}>
                    {broadcastHistory.length > 0 ? broadcastHistory[broadcastHistory.length - 1].time : 'PUBLIC'}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '7.5px',
                    color: '#94a3b8',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginTop: '1px',
                  }}
                >
                  {broadcastHistory.length > 0
                    ? `📢 ${broadcastHistory[broadcastHistory.length - 1].senderName}: ${broadcastHistory[broadcastHistory.length - 1].text}`
                    : 'Tap to view live LAN announcements'}
                </div>
              </div>

              {/* Delete PA History Recycle Bin Icon */}
              {broadcastHistory.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClearBroadcastHistory()
                  }}
                  title="Clear PA announcements history"
                  style={{
                    background: '#23151b',
                    border: '1px solid #ef444455',
                    borderRadius: '4px',
                    padding: '3px 4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <TrashIcon size={10} color="#ef4444" />
                </button>
              )}
            </div>

            {/* 2. Active Chat Rooms with Previous/New Messages */}
            {activeChatRooms.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#64748b', fontSize: '8px', padding: '20px 8px' }}>
                No active chat conversations with colleagues yet.
              </div>
            ) : (
              activeChatRooms.map(({ slotNum, targetExt, peer, isRegistered, messages, lastMsg }) => {
                const isPeerInActiveCall = Boolean(
                  isRegistered &&
                  (callState === 'active' || callState === 'calling' || callState === 'ringing') &&
                  (selectedPeer?.id === peer.id || selectedPeer?.ext === targetExt)
                )

                const statusColor = isPeerInActiveCall
                  ? '#ef4444'
                  : isRegistered
                  ? STATUS_COLOR[peer.status] || '#6b7280'
                  : '#333348'

                return (
                  <div
                    key={slotNum}
                    onClick={() => handleOpenRoom(peer)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '5px 8px',
                      background: isPeerInActiveCall
                        ? 'linear-gradient(180deg, #2b1218 0%, #1c0c10 100%)'
                        : isRegistered
                        ? 'linear-gradient(180deg, #181828 0%, #131320 100%)'
                        : 'linear-gradient(180deg, #12121c 0%, #0d0d16 100%)',
                      borderRadius: '6px',
                      border: `1px solid ${isPeerInActiveCall ? '#ef444488' : isRegistered ? '#2b2b45' : '#1e1e2c'}`,
                      cursor: 'pointer',
                      transition: 'all 0.1s ease',
                      position: 'relative',
                    }}
                  >
                    {/* Avatar & Status LED */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          background: isPeerInActiveCall ? '#451a24' : isRegistered ? '#28283e' : '#1a1a26',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: '9px',
                          fontWeight: 700,
                          color: isPeerInActiveCall ? '#fca5a5' : isRegistered ? '#e2e8f0' : '#475569',
                        }}
                      >
                        {slotNum}
                      </div>

                      {isRegistered && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '-1px',
                            right: '-1px',
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: statusColor,
                            boxShadow: `0 0 5px ${statusColor}`,
                            animation: isPeerInActiveCall ? 'pulse 1.4s infinite' : 'none',
                          }}
                        />
                      )}
                    </div>

                    {/* Room Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span
                            style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: '8px',
                              fontWeight: 700,
                              color: isPeerInActiveCall ? '#fca5a5' : isRegistered ? '#e2e8f0' : '#64748b',
                            }}
                          >
                            {peer.name.toUpperCase()}
                          </span>
                          <span
                            style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: '6.5px',
                              color: isPeerInActiveCall ? '#f87171' : isRegistered ? '#22c55e' : '#475569',
                              fontWeight: isPeerInActiveCall ? 700 : 600,
                            }}
                          >
                            {isPeerInActiveCall ? '🔴 IN CALL' : `EXT ${targetExt}`}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {lastMsg && (
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '6px', color: '#64748b' }}>
                              {lastMsg.time}
                            </span>
                          )}

                          {messages.filter((m) => {
                            const isFromMyself =
                              m.from === 'me' ||
                              String(m.senderId).trim() === String(myProfile.id).trim() ||
                              String(m.senderExt).trim() === String(myProfile.ext).trim()

                            return (
                              !isFromMyself &&
                              m.from === 'them' &&
                              m.status !== 'read' &&
                              !m.isDeleted
                            )
                          }).length > 0 && (
                            <span
                              style={{
                                minWidth: '13px',
                                height: '13px',
                                borderRadius: '7px',
                                background: '#ef4444',
                                color: '#ffffff',
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: '7px',
                                fontWeight: 800,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '0 3px',
                                boxShadow: '0 0 6px rgba(239, 68, 68, 0.6)',
                              }}
                            >
                              {messages.filter((m) => {
                                const isFromMyself =
                                  m.from === 'me' ||
                                  String(m.senderId).trim() === String(myProfile.id).trim() ||
                                  String(m.senderExt).trim() === String(myProfile.ext).trim()

                                return (
                                  !isFromMyself &&
                                  m.from === 'them' &&
                                  m.status !== 'read' &&
                                  !m.isDeleted
                                )
                              }).length}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Last Message Snippet */}
                      <div
                        style={{
                          fontFamily: 'Inter, sans-serif',
                          fontSize: '7.5px',
                          color: isRegistered ? '#94a3b8' : '#475569',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          marginTop: '1px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px',
                        }}
                      >
                        {lastMsg ? (
                          <>
                            {lastMsg.from === 'me' && <span style={{ color: '#38bdf8' }}>✓✓</span>}
                            <span>{lastMsg.text}</span>
                          </>
                        ) : isRegistered ? (
                          <span style={{ color: '#64748b' }}>No messages yet · Tap to chat</span>
                        ) : (
                          <span style={{ color: '#475569' }}>Unassigned · Waiting for LAN registration</span>
                        )}
                      </div>
                    </div>

                    {/* Delete Room History Recycle Bin Button */}
                    {messages.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onClearRoomChat(peer)
                        }}
                        title={`Delete all chats in EXT ${targetExt}`}
                        style={{
                          background: '#23151b',
                          border: '1px solid #ef444455',
                          borderRadius: '4px',
                          padding: '3px 4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <TrashIcon size={10} color="#ef4444" />
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      ) : (
        /* ─────────────────────────────────────────────────────────────
            VIEW 2: INDIVIDUAL CHAT ROOM (SHOWS PREVIOUS & NEW MESSAGES)
        ───────────────────────────────────────────────────────────── */
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Room Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 8px',
              background: '#161626',
              borderBottom: '1px solid #282840',
            }}
          >
            {/* Back Button + Peer Info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                onClick={handleBackToRooms}
                style={{
                  background: '#202036',
                  border: '1px solid #333355',
                  borderRadius: '4px',
                  padding: '2px 5px',
                  fontSize: '8px',
                  color: '#60a5fa',
                  cursor: 'pointer',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                }}
                title="Back to all chat rooms"
              >
                ← ROOMS
              </button>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {broadcastRoomActive ? (
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '8.5px',
                        fontWeight: 700,
                        color: '#60a5fa',
                      }}
                    >
                      📢 ALL-STATION PA CHANNEL
                    </span>
                  ) : activeRoomPeer ? (() => {
                    const isCallActiveWithPeer =
                      (callState === 'calling' || callState === 'active' || callState === 'ringing') &&
                      (selectedPeer?.id === activeRoomPeer.id || selectedPeer?.ext === activeRoomPeer.ext)

                    return (
                      <>
                        <div
                          style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: isCallActiveWithPeer ? '#ef4444' : STATUS_COLOR[activeRoomPeer.status] || '#22c55e',
                            boxShadow: `0 0 6px ${isCallActiveWithPeer ? '#ef4444' : STATUS_COLOR[activeRoomPeer.status] || '#22c55e'}`,
                            animation: isCallActiveWithPeer ? 'pulse 1.4s infinite' : 'none',
                          }}
                        />
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: '8.5px',
                            fontWeight: 700,
                            color: '#ffffff',
                          }}
                        >
                          {activeRoomPeer.name.toUpperCase()}
                        </span>
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: '7px',
                            color: isCallActiveWithPeer ? '#f87171' : '#22c55e',
                            fontWeight: isCallActiveWithPeer ? 700 : 500,
                          }}
                        >
                          {isCallActiveWithPeer
                            ? callState === 'active'
                              ? '🔴 IN CALL'
                              : '📞 CALLING'
                            : `EXT ${activeRoomPeer.ext}`}
                        </span>
                      </>
                    )
                  })() : null}
                </div>
              </div>
            </div>

            {/* Right: Call + Delete Room + Close */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {/* Recycle Bin Button inside active room */}
              {broadcastRoomActive ? (
                broadcastHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearBroadcastHistory}
                    style={{
                      background: '#23151b',
                      border: '1px solid #ef444455',
                      borderRadius: '4px',
                      padding: '2px 5px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                    }}
                    title="Clear all broadcast messages"
                  >
                    <TrashIcon size={10} color="#ef4444" />
                  </button>
                )
              ) : activeRoomPeer && currentMessages.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onClearRoomChat(activeRoomPeer)}
                  style={{
                    background: '#23151b',
                    border: '1px solid #ef444455',
                    borderRadius: '4px',
                    padding: '2px 5px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                  title={`Delete all messages in this chat room`}
                >
                  <TrashIcon size={10} color="#ef4444" />
                </button>
              ) : null}

              {!broadcastRoomActive && activeRoomPeer && activeRoomPeer.id !== myProfile.id && (() => {
                const isCallActiveWithPeer =
                  (callState === 'calling' || callState === 'active' || callState === 'ringing') &&
                  (selectedPeer?.id === activeRoomPeer.id || selectedPeer?.ext === activeRoomPeer.ext)

                return (
                  <button
                    type="button"
                    onClick={
                      isCallActiveWithPeer
                        ? () => onEndCall?.()
                        : () => onCallPeer(activeRoomPeer)
                    }
                    style={{
                      background: isCallActiveWithPeer
                        ? 'linear-gradient(180deg, #ef4444 0%, #dc2626 100%)'
                        : 'linear-gradient(180deg, #16a34a 0%, #15803d 100%)',
                      border: isCallActiveWithPeer ? '1px solid #f87171' : '1px solid #22c55e',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      fontSize: '7.5px',
                      color: '#ffffff',
                      cursor: 'pointer',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      boxShadow: isCallActiveWithPeer
                        ? '0 0 8px rgba(239, 68, 68, 0.65)'
                        : '0 0 6px rgba(34, 197, 94, 0.45)',
                      animation: isCallActiveWithPeer ? 'pulse 1.4s infinite' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                    title={
                      isCallActiveWithPeer
                        ? `End active call with ${activeRoomPeer.name}`
                        : `Call ${activeRoomPeer.name}`
                    }
                  >
                    {isCallActiveWithPeer ? (
                      <>
                        <span style={{ fontSize: '7px' }}>🔴</span> END
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: '8px' }}>📞</span> CALL
                      </>
                    )}
                  </button>
                )
              })()}

              <button
                type="button"
                onClick={onClose}
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: 'linear-gradient(180deg, #ef4444 0%, #dc2626 100%)',
                  border: '1.2px solid #fca5a5',
                  color: '#ffffff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 8px rgba(239, 68, 68, 0.55), inset 0 1px 0 rgba(255,255,255,0.4)',
                  padding: 0,
                  outline: 'none',
                  flexShrink: 0,
                  transition: 'transform 0.1s ease, box-shadow 0.1s ease',
                }}
                title="Close messages"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages Scroll Area */}
          <div
            ref={messagesContainerRef}
            onScroll={handleScrollMessages}
            style={{
              flex: 1,
              overflowY: 'auto',
              scrollbarWidth: 'none',
              padding: '8px 8px 4px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              background: '#0a0a14',
              position: 'relative',
            }}
          >
            {broadcastRoomActive ? (
              broadcastHistory.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748b', fontSize: '8px', padding: '24px 0' }}>
                  No PA announcements broadcast yet.
                </div>
              ) : (
                broadcastHistory.map((ann) => (
                  <div
                    key={ann.id}
                    style={{
                      background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
                      border: '1px solid #3b82f644',
                      borderRadius: '8px',
                      padding: '6px 8px',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '7.5px', color: '#60a5fa', fontWeight: 700 }}>
                        📢 {ann.senderName.toUpperCase()} (EXT {ann.senderExt})
                      </span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '6.5px', color: '#64748b' }}>
                        {ann.time}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '8.5px', color: '#f8fafc' }}>
                      {ann.text}
                    </div>
                  </div>
                ))
              )
            ) : currentMessages.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#64748b', fontSize: '8px', padding: '24px 0' }}>
                Start a conversation with {activeRoomPeer?.name || 'this unit'}...
              </div>
            ) : (
              currentMessages.map((msg, idx) => {
                const prevMsg = idx > 0 ? currentMessages[idx - 1] : null
                const showDateHeader = idx === 0 || isDifferentDay(prevMsg?.timestamp, msg.timestamp)
                const isMe = msg.from === 'me'

                return (
                  <React.Fragment key={msg.id}>
                    {showDateHeader && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '100%',
                          margin: '6px 0 3px',
                        }}
                      >
                        <span
                          style={{
                            background: '#141424',
                            border: '1px solid #282844',
                            borderRadius: '10px',
                            padding: '1.5px 8px',
                            fontSize: '6.5px',
                            fontFamily: "'JetBrains Mono', monospace",
                            color: '#64748b',
                            fontWeight: 700,
                            letterSpacing: '0.08em',
                          }}
                        >
                          {fmtDateHeader(msg.timestamp)}
                        </span>
                      </div>
                    )}

                    {msg.type === 'call-log' ? (
                      msg.isDeleted ? (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            width: '100%',
                            margin: '3px 0',
                            position: 'relative',
                          }}
                        >
                          <div
                            style={{
                              background: 'rgba(51, 65, 85, 0.25)',
                              border: '1px dashed rgba(148, 163, 184, 0.3)',
                              borderRadius: '14px',
                              padding: '3px 8px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px',
                              maxWidth: '94%',
                            }}
                          >
                            <span style={{ fontSize: '9px' }}>🚫</span>
                            <span
                              style={{
                                fontFamily: 'Inter, sans-serif',
                                fontSize: '7.5px',
                                fontStyle: 'italic',
                                color: '#94a3b8',
                              }}
                            >
                              This call log was deleted
                            </span>
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '6.5px', color: '#64748b', marginLeft: '2px' }}>
                              {msg.time}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onDeleteSingleMessage(msg.id)
                              }}
                              title="Remove from history"
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: '0 1px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                opacity: 0.6,
                                marginLeft: '2px',
                              }}
                            >
                              <TrashIcon size={8.5} color="#ef4444" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            width: '100%',
                            margin: '3px 0',
                            position: 'relative',
                          }}
                        >
                          <div
                            style={{
                              background:
                                msg.callType === 'missed' || msg.callType === 'declined'
                                  ? 'linear-gradient(180deg, rgba(239,68,68,0.18) 0%, rgba(185,28,28,0.1) 100%)'
                                  : msg.callType === 'page'
                                  ? 'linear-gradient(180deg, rgba(245,158,11,0.18) 0%, rgba(180,83,9,0.1) 100%)'
                                  : msg.callType === 'outgoing'
                                  ? 'linear-gradient(180deg, rgba(59,130,246,0.18) 0%, rgba(37,99,235,0.1) 100%)'
                                  : 'linear-gradient(180deg, rgba(34,197,94,0.18) 0%, rgba(21,128,61,0.1) 100%)',
                              border: `1px solid ${
                                msg.callType === 'missed' || msg.callType === 'declined'
                                  ? 'rgba(239, 68, 68, 0.4)'
                                  : msg.callType === 'page'
                                  ? 'rgba(245, 158, 11, 0.4)'
                                  : msg.callType === 'outgoing'
                                  ? 'rgba(96, 165, 250, 0.4)'
                                  : 'rgba(74, 222, 128, 0.4)'
                              }`,
                              borderRadius: '14px',
                              padding: '3px 8px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px',
                              maxWidth: '94%',
                              boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                            }}
                          >
                            <span style={{ fontSize: '10px', lineHeight: 1 }}>
                              {msg.callType === 'missed' || msg.callType === 'declined'
                                ? '📵'
                                : msg.callType === 'page'
                                ? '🚨'
                                : msg.callType === 'incoming'
                                ? '📲'
                                : '📞'}
                            </span>
                            <span
                              style={{
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: '7.5px',
                                color:
                                  msg.callType === 'missed' || msg.callType === 'declined'
                                    ? '#f87171'
                                    : msg.callType === 'page'
                                    ? '#fbbf24'
                                    : msg.callType === 'outgoing'
                                    ? '#93c5fd'
                                    : '#86efac',
                                fontWeight: 700,
                                lineHeight: 1.2,
                              }}
                            >
                              {msg.text}
                            </span>
                            <span
                              style={{
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: '6.5px',
                                color: '#94a3b8',
                                marginLeft: '2px',
                              }}
                            >
                              {msg.time}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onDeleteSingleMessage(msg.id)
                              }}
                              title="Delete call log"
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: '0 1px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                opacity: 0.6,
                                marginLeft: '2px',
                              }}
                            >
                              <TrashIcon size={8.5} color="#ef4444" />
                            </button>
                          </div>
                        </div>
                      )
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: isMe ? 'flex-end' : 'flex-start',
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            maxWidth: '84%',
                            background: msg.isDeleted
                              ? 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)'
                              : isMe
                              ? 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)'
                              : 'linear-gradient(180deg, #1f2937 0%, #111827 100%)',
                            border: `1px solid ${
                              msg.isDeleted ? '#475569' : isMe ? '#60a5fa55' : '#374151'
                            }`,
                            borderRadius: isMe ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
                            padding: '5px 8px',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                            position: 'relative',
                          }}
                        >
                          {/* Sender identity label for incoming messages */}
                          {!isMe && (
                            <div
                              style={{
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: '6.5px',
                                fontWeight: 700,
                                color: '#4ade80',
                                marginBottom: '2px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px',
                              }}
                            >
                              <span>{msg.senderName}</span>
                              <span style={{ color: '#22c55e99', fontSize: '6px' }}>EXT {msg.senderExt}</span>
                            </div>
                          )}

                          {/* Deleted Message, Voice Note, or Text */}
                          {msg.isDeleted ? (
                            <div
                              style={{
                                fontFamily: 'Inter, sans-serif',
                                fontSize: '8px',
                                fontStyle: 'italic',
                                color: '#94a3b8',
                                lineHeight: 1.3,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <span>🚫</span>
                              <span>This message was deleted</span>
                            </div>
                          ) : msg.audioData || msg.text.startsWith('🎤') ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <button
                                type="button"
                                onClick={() => playVoiceNote(msg.id, msg.audioData)}
                                style={{
                                  width: '20px',
                                  height: '20px',
                                  borderRadius: '50%',
                                  background: isMe ? '#1e40af' : '#2563eb',
                                  border: 'none',
                                  color: '#fff',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '9px',
                                }}
                              >
                                {playingAudioId === msg.id ? '⏸' : '▶'}
                              </button>
                              <span style={{ fontSize: '8px', color: '#fff' }}>{msg.text}</span>
                            </div>
                          ) : (
                            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '8.5px', color: '#ffffff', lineHeight: 1.3 }}>
                              {msg.text}
                            </div>
                          )}

                          {/* Time, Checkmarks, & Single Message Delete Icon */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                              gap: '4px',
                              marginTop: '2px',
                            }}
                          >
                            <span
                              style={{
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: '6px',
                                color: isMe ? '#bfdbfe' : '#94a3b8',
                              }}
                            >
                              {msg.time}
                            </span>
                            {isMe && (
                              <span style={{ fontSize: '6.5px', color: msg.status === 'read' ? '#38bdf8' : '#93c5fd' }}>
                                {msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : '✓'}
                              </span>
                            )}

                            {/* Individual message delete button */}
                            <button
                              type="button"
                              onClick={() => onDeleteSingleMessage(msg.id)}
                              title="Delete message"
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                opacity: 0.6,
                                marginLeft: '2px',
                              }}
                            >
                              <TrashIcon size={9} color={isMe ? '#bfdbfe' : '#94a3b8'} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                )
              })
            )}
          </div>

          {/* Floating Jump to Latest Button (Shown when user has scrolled up to view chat history) */}
          {showScrollBottomBtn && (
            <div style={{ position: 'relative', width: '100%', height: 0 }}>
              <button
                type="button"
                onClick={() => scrollToBottom(true)}
                style={{
                  position: 'absolute',
                  bottom: '8px',
                  right: '10px',
                  background: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
                  border: '1px solid #60a5fa',
                  color: '#ffffff',
                  borderRadius: '12px',
                  padding: '3px 8px',
                  fontSize: '7.5px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.6), 0 0 10px rgba(59,130,246,0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  zIndex: 20,
                  animation: 'pulse-dot 1.5s infinite',
                }}
                title="Scroll down to newest messages"
              >
                <span>↓</span>
                <span>LATEST</span>
              </button>
            </div>
          )}

          {/* Quick Replies Chips */}
          {!broadcastRoomActive && (
            <div
              style={{
                display: 'flex',
                gap: '4px',
                overflowX: 'auto',
                scrollbarWidth: 'none',
                padding: '3px 6px',
                background: '#0d0d18',
                borderTop: '1px solid #1f1f33',
              }}
            >
              {QUICK_REPLIES.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  onClick={() => handleSend(reply)}
                  style={{
                    background: '#18182c',
                    border: '1px solid #282845',
                    borderRadius: '10px',
                    padding: '2px 7px',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '7px',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {reply}
                </button>
              ))}
            </div>
          )}

          {/* Bottom Chat Input Bar */}
          {!broadcastRoomActive && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '5px 8px 6px',
                background: '#131322',
                borderTop: '1px solid #25253d',
              }}
            >
              {/* Mic Voice Note Button */}
              <button
                type="button"
                onMouseDown={startVoiceRecording}
                onMouseUp={stopVoiceRecording}
                onTouchStart={startVoiceRecording}
                onTouchEnd={stopVoiceRecording}
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: isRecording ? '#ef4444' : '#1e293b',
                  border: isRecording ? '1px solid #f87171' : '1px solid #334155',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  boxShadow: isRecording ? '0 0 10px rgba(239,68,68,0.7)' : 'none',
                  transition: 'all 0.15s ease',
                  flexShrink: 0,
                }}
                title="Hold to record voice note"
              >
                🎤
              </button>

              {/* Text Input */}
              <input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSend()
                }}
                placeholder="Type a message..."
                style={{
                  flex: 1,
                  background: '#0a0a14',
                  border: '1px solid #2a2a44',
                  borderRadius: '12px',
                  padding: '5px 8px',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '8.5px',
                  color: '#ffffff',
                  outline: 'none',
                }}
              />

              {/* Send Button */}
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!inputText.trim()}
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: inputText.trim()
                    ? 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)'
                    : '#1e293b',
                  border: 'none',
                  color: '#fff',
                  cursor: inputText.trim() ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  opacity: inputText.trim() ? 1 : 0.4,
                  flexShrink: 0,
                }}
                title="Send message"
              >
                ➤
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
