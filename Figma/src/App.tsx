import React, { useState, useEffect, useRef, useMemo, useCallback, Component, ErrorInfo, ReactNode } from 'react'
import { Peer, Status, CallState, Message, CallSignal, NetworkStats, BroadcastAnnouncement, SystemSettings, DEFAULT_SYSTEM_SETTINGS, CallSession } from './types/opap'
import { p2pNetwork } from './services/p2pNetwork'
import { voiceCall } from './services/voiceCall'
import { sound } from './services/soundSynthesizer'
import { LcdScreen } from './components/LcdScreen'
import { DialerGrid } from './components/DialerGrid'
import { ChatPanel } from './components/ChatPanel'
import { IncomingCallModal } from './components/IncomingCallModal'
import { IncomingPageModal } from './components/IncomingPageModal'
import { CallWaitingModal } from './components/CallWaitingModal'
import { BroadcastModal } from './components/BroadcastModal'
import { NetworkSettingsModal } from './components/NetworkSettingsModal'
import { RegistrationModal } from './components/RegistrationModal'

// Error Boundary
interface ErrorBoundaryProps {
  children: ReactNode
}
interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('OPAP App Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '24px', color: '#ff5555', background: '#0a0a14', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h2>OPAP Mobile Error</h2>
          <pre>{this.state.error?.message || String(this.state.error)}</pre>
          <button
            onClick={() => {
              localStorage.clear()
              sessionStorage.clear()
              window.location.reload()
            }}
            style={{ marginTop: '16px', padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            Reset Local Storage & Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
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

const STATUS_CYCLE: Status[] = ['idle', 'busy', 'away', 'dnd']

function fmtTime(d: Date) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function MainApp() {
  // Self-assignment before use
  const [showRegistration, setShowRegistration] = useState<boolean>(() => {
    try {
      return !localStorage.getItem('opap_registered')
    } catch {
      return false
    }
  })

  // Default display is always the Dial Pad (Pager), chatMode = false
  const [chatMode, setChatMode] = useState(false)
  const [selected, setSelected] = useState<Peer | null>(null)
  const [peers, setPeers] = useState<Peer[]>(() => p2pNetwork.getDiscoveredPeers())
  const [myProfile, setMyProfile] = useState<Peer>(() => p2pNetwork.getMyProfile())
  const [callState, setCallState] = useState<CallState>('idle')
  const [callTimer, setCallTimer] = useState(0)
  const [audioLevel, setAudioLevel] = useState(0)
  const [isMuted, setIsMuted] = useState(false)

  // In-template auto-hiding guide with drawer tab (placed after footer)
  const [showGuide, setShowGuide] = useState(true)
  const guideTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Modals & Banners
  const [incomingCallData, setIncomingCallData] = useState<{ signal: CallSignal; caller: Peer } | null>(null)
  const [incomingPageData, setIncomingPageData] = useState<{ signal: CallSignal; caller: Peer } | null>(null)
  const [showBroadcastModal, setShowBroadcastModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [broadcastAlert, setBroadcastAlert] = useState<string | null>(null)

  // GSM Telephony Multi-Call & Conference States
  const [waitingCall, setWaitingCall] = useState<{ signal: CallSignal; caller: Peer } | null>(null)
  const [heldPeer, setHeldPeer] = useState<Peer | null>(null)
  const [isConference, setIsConference] = useState(false)
  const [isHeldByRemote, setIsHeldByRemote] = useState(false)
  const [activeSessions, setActiveSessions] = useState<CallSession[]>([])
  const [candidateToAdd, setCandidateToAdd] = useState<Peer | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)

  // Persistent Chats & Broadcast History
  const [chats, setChats] = useState<Record<string, Message[]>>(() => {
    try {
      const saved = localStorage.getItem('opap_chat_history_v2')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })

  const [broadcastHistory, setBroadcastHistory] = useState<BroadcastAnnouncement[]>(() => {
    try {
      const saved = localStorage.getItem('opap_broadcast_history_v2')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  const [netStats, setNetStats] = useState<NetworkStats>(() => p2pNetwork.getNetworkStats())
  const [isSoundMuted, setIsSoundMuted] = useState(false)
  const [isMicMuted, setIsMicMuted] = useState(false)
  const [clock, setClock] = useState(() => fmtTime(new Date()))

  // App Sound Volume (0 to 100, persistent)
  const [appVolume, setAppVolume] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('opap_volume_level')
      if (saved !== null) {
        const parsed = parseInt(saved, 10)
        if (!isNaN(parsed)) return Math.max(0, Math.min(100, parsed))
      }
    } catch {}
    return 80
  })

  useEffect(() => {
    sound.setVolume(appVolume / 100)
  }, [appVolume])

  const handleVolumeChange = (newVol: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(newVol)))
    setAppVolume(clamped)
    sound.setVolume(clamped / 100)
    try {
      localStorage.setItem('opap_volume_level', String(clamped))
    } catch {}
  }

  const handleToggleMuteMic = () => {
    const next = voiceCall.toggleMute()
    setIsMicMuted(next)
  }

  // PiP (Picture-in-Picture / Right Screen Bezel Dock) Mode
  const [isPipMode, setIsPipMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('opap_pip_mode')
      return saved !== null ? saved === 'true' : true
    } catch {
      return true
    }
  })

  // Always start straight in the visible app interface (never in hover/hidden mode on launch)
  const [isPipCollapsed, setIsPipCollapsed] = useState<boolean>(false)
  const [isEdgeHovered, setIsEdgeHovered] = useState<boolean>(false)
  const mainStationRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem('opap_pip_collapsed', 'false')
    } catch {}
  }, [])

  const handleTogglePipMode = () => {
    sound.playKeyClick()
    const nextMode = !isPipMode
    setIsPipMode(nextMode)
    setIsPipCollapsed(false) // Go straight into expanded PiP mode attached to bezel
    try {
      localStorage.setItem('opap_pip_mode', String(nextMode))
      localStorage.setItem('opap_pip_collapsed', 'false')
    } catch {}
  }

  const handleTogglePipCollapse = () => {
    sound.playKeyClick()
    const nextCollapsed = !isPipCollapsed
    setIsPipCollapsed(nextCollapsed)
  }

  // On click outside of the app interface, go to hidden mode
  useEffect(() => {
    if (!isPipMode || isPipCollapsed) return

    const handleClickOutside = (e: MouseEvent | TouchEvent | PointerEvent) => {
      if (mainStationRef.current && !mainStationRef.current.contains(e.target as Node)) {
        const hotspot = document.getElementById('opap-pip-edge-hotspot')
        if (hotspot && hotspot.contains(e.target as Node)) return

        setIsPipCollapsed(true)
      }
    }

    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', handleClickOutside, true)
      window.addEventListener('mousedown', handleClickOutside, true)
      window.addEventListener('touchstart', handleClickOutside, true)
    }, 60)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', handleClickOutside, true)
      window.removeEventListener('mousedown', handleClickOutside, true)
      window.removeEventListener('touchstart', handleClickOutside, true)
    }
  }, [isPipMode, isPipCollapsed])

  // Admin System Settings (Synced across LAN Mesh)
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(() => {
    try {
      const saved = localStorage.getItem('opap_system_settings_v1')
      return saved ? { ...DEFAULT_SYSTEM_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SYSTEM_SETTINGS
    } catch {
      return DEFAULT_SYSTEM_SETTINGS
    }
  })

  // Synchronize initial timing to VoiceCallManager
  useEffect(() => {
    voiceCall.setSystemTiming(systemSettings.callRingDuration, systemSettings.pageToneDuration)
  }, [systemSettings.callRingDuration, systemSettings.pageToneDuration])

  // Save systemSettings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('opap_system_settings_v1', JSON.stringify(systemSettings))
    } catch {}
  }, [systemSettings])

  // Save chats to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('opap_chat_history_v2', JSON.stringify(chats))
    } catch {}
  }, [chats])

  // Save broadcasts to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('opap_broadcast_history_v2', JSON.stringify(broadcastHistory))
    } catch {}
  }, [broadcastHistory])

  // Initial auto-hide guide after 6 seconds
  useEffect(() => {
    guideTimerRef.current = setTimeout(() => {
      setShowGuide(false)
    }, 6000)
    return () => {
      if (guideTimerRef.current) clearTimeout(guideTimerRef.current)
    }
  }, [])

  const openGuide = () => {
    sound.playKeyClick()
    setShowGuide(true)
    if (guideTimerRef.current) clearTimeout(guideTimerRef.current)
    guideTimerRef.current = setTimeout(() => {
      setShowGuide(false)
    }, 10000)
  }

  const closeGuide = () => {
    sound.playKeyClick()
    if (guideTimerRef.current) clearTimeout(guideTimerRef.current)
    setShowGuide(false)
  }

  // Clock interval
  useEffect(() => {
    const id = setInterval(() => setClock(fmtTime(new Date())), 1000)
    return () => clearInterval(id)
  }, [])

  // Call duration timer - syncs with voice engine directly
  useEffect(() => {
    const engineActive = voiceCall.getCallState() === 'active'
    const reactActive = callState === 'active'
    if (!engineActive && !reactActive) {
      setCallTimer(0)
      return
    }
    const id = setInterval(() => setCallTimer((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [callState])

  // Helper to append message cleanly across multiple identifier keys
  const saveMessageToChats = (msg: Message, extraPeer?: Peer | null) => {
    if (!msg.timestamp) {
      msg.timestamp = Date.now()
    }
    setChats((prev) => {
      const next = { ...prev }
      const keys = [
        msg.senderId,
        msg.senderExt,
        msg.recipientId,
        msg.recipientExt,
        msg.targetId,
        msg.targetExt,
        `ext-${msg.senderExt}`,
        msg.recipientExt ? `ext-${msg.recipientExt}` : undefined,
        msg.targetExt ? `ext-${msg.targetExt}` : undefined,
        msg.recipientId && msg.recipientId !== 'all' ? `ext-${msg.recipientId.replace(/^ext-/, '')}` : undefined,
        extraPeer?.id,
        extraPeer?.ext,
        extraPeer ? `ext-${extraPeer.ext}` : undefined,
      ].filter(Boolean) as string[]

      keys.forEach((k) => {
        const list = next[k] || []
        if (!list.some((m) => m.id === msg.id)) {
          next[k] = [...list, msg]
        }
      })
      return next
    })
  }

  // Delete/Clear room chat
  const handleClearRoomChat = (peer: Peer) => {
    sound.playKeyClick()
    setChats((prev) => {
      const next = { ...prev }
      const keys = [
        peer.id,
        peer.ext,
        `ext-${peer.ext}`,
        `ext-${peer.ext.replace(/^10/, '')}`,
      ]
      keys.forEach((k) => {
        delete next[k]
      })
      return next
    })
  }

  // Delete/Clear broadcast announcements history
  const handleClearBroadcastHistory = () => {
    sound.playKeyClick()
    setBroadcastHistory([])
    try {
      localStorage.removeItem('opap_broadcast_history_v2')
    } catch {}
  }

  // Delete a single message / call log
  // Rules:
  // 1. If Receiver deletes: ONLY deletes locally on their side (does NOT affect sender).
  // 2. If Sender deletes: Affects BOTH sides ("Delete for everyone").
  const handleDeleteSingleMessage = (msgId: string) => {
    sound.playKeyClick()

    // Find the message across chats
    let targetMessage: Message | null = null
    Object.values(chats).forEach((list) => {
      const found = list.find((m) => m.id === msgId)
      if (found) {
        targetMessage = found
      }
    })

    if (!targetMessage) return

    const isSender =
      (targetMessage as Message).from === 'me' ||
      (targetMessage as Message).senderId === myProfile.id ||
      (targetMessage as Message).senderExt === myProfile.ext

    if (!isSender) {
      // Receiver deletion: ONLY delete locally ("Delete for me")
      setChats((prev) => {
        const next = { ...prev }
        Object.keys(next).forEach((k) => {
          next[k] = next[k].filter((m) => m.id !== msgId)
        })
        return next
      })
      return
    }

    // Sender deletion: Affects BOTH sides
    if ((targetMessage as Message).isDeleted) {
      // Permanently remove from sender's view if deleted a second time
      setChats((prev) => {
        const next = { ...prev }
        Object.keys(next).forEach((k) => {
          next[k] = next[k].filter((m) => m.id !== msgId)
        })
        return next
      })
      return
    }

    // Mark as deleted locally for sender
    setChats((prev) => {
      const next = { ...prev }
      Object.keys(next).forEach((k) => {
        next[k] = next[k].map((m) => {
          if (m.id === msgId) {
            return {
              ...m,
              isDeleted: true,
              text: m.type === 'call-log' ? '🚫 This call log was deleted' : '🚫 This message was deleted',
              audioData: undefined,
            }
          }
          return m
        })
      })
      return next
    })

    // Broadcast deletion signal to peer ("Delete for everyone")
    const targetPeerId = (targetMessage as Message).recipientId || (targetMessage as Message).targetId
    p2pNetwork.sendDeleteMessage(msgId, targetPeerId)
  }

  const lastCallPeerRef = useRef<Peer | null>(null)
  const isCallerRef = useRef<boolean>(false)
  const lastCallTimerRef = useRef<number>(0)
  const callActiveSessionRef = useRef<boolean>(false)
  const callLoggedSessionRef = useRef<boolean>(false)

  useEffect(() => {
    lastCallTimerRef.current = callTimer
  }, [callTimer])

  // Helper to log call events directly into chat history
  const logCallToChat = (
    peer: Peer,
    callType: 'outgoing' | 'incoming' | 'missed' | 'declined' | 'page',
    durationSeconds: number = 0,
    note?: string
  ) => {
    if (!peer || peer.name === 'UNASSIGNED') return

    const fmtDur = (s: number) => {
      const m = Math.floor(s / 60)
      const sec = s % 60
      return `${m}:${sec.toString().padStart(2, '0')}`
    }

    let text = ''
    if (callType === 'outgoing') {
      text = durationSeconds > 0 ? `📞 Outgoing Call (${fmtDur(durationSeconds)})` : (note || `📞 Not Answered`)
    } else if (callType === 'incoming') {
      text = durationSeconds > 0 ? `📲 Incoming Call (${fmtDur(durationSeconds)})` : (note || `📲 Incoming Call`)
    } else if (callType === 'missed') {
      text = note || `📵 Missed Call`
    } else if (callType === 'declined') {
      text = note || `🚫 Declined`
    } else if (callType === 'page') {
      text = note || `🚨 Pager Alert`
    }

    const isOutgoing = callType === 'outgoing' || (isCallerRef.current && callType !== 'incoming' && callType !== 'missed')
    const now = new Date()
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    const callLogMsg: Message = {
      id: `call-log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      senderId: isOutgoing ? myProfile.id : peer.id,
      senderName: isOutgoing ? myProfile.name : peer.name,
      senderExt: isOutgoing ? myProfile.ext : peer.ext,
      recipientId: isOutgoing ? peer.id : myProfile.id,
      recipientExt: isOutgoing ? peer.ext : myProfile.ext,
      targetId: isOutgoing ? peer.id : myProfile.id,
      targetExt: isOutgoing ? peer.ext : myProfile.ext,
      text,
      time: timeStr,
      timestamp: Date.now(),
      from: isOutgoing ? 'me' : 'them',
      status: isOutgoing ? 'delivered' : 'delivered',
      type: 'call-log',
      callType,
      callDuration: durationSeconds,
    }

    saveMessageToChats(callLogMsg, peer)
  }

  // P2P Network subscriptions
  useEffect(() => {
    const unsubPeers = p2pNetwork.onPeersUpdated((updatedPeers) => {
      setPeers(updatedPeers)
      setSelected((prev) => {
        if (!prev) return null
        const found = updatedPeers.find((p) => p.id === prev.id || p.ext === prev.ext)
        return found || prev
      })
    })

    const unsubChat = p2pNetwork.onChatMessage((msg) => {
      // Ignore text-based page notifications; use pill call-log style only
      if (msg.text.startsWith('[PAGE ACK]') || msg.text.startsWith('[PAGE DECLINED]')) {
        return
      }
      saveMessageToChats(msg)
    })

    const unsubAck = p2pNetwork.onMessageAck(({ messageId, status }) => {
      setChats((prev) => {
        const next = { ...prev }
        Object.keys(next).forEach((k) => {
          next[k] = next[k].map((m) => (m.id === messageId ? { ...m, status } : m))
        })
        return next
      })
    })

    const unsubDelete = p2pNetwork.onMessageDelete(({ messageId }) => {
      setChats((prev) => {
        const next = { ...prev }
        Object.keys(next).forEach((k) => {
          next[k] = next[k].map((m) => {
            if (m.id === messageId) {
              return {
                ...m,
                isDeleted: true,
                text: m.type === 'call-log' ? '🚫 This call log was deleted' : '🚫 This message was deleted',
                audioData: undefined,
              }
            }
            return m
          })
        })
        return next
      })
    })

    const unsubBroadcast = p2pNetwork.onBroadcast((announcement) => {
      setBroadcastAlert(`${announcement.senderName}: ${announcement.text}`)
      setBroadcastHistory((prev) => [...prev, announcement])
      setTimeout(() => setBroadcastAlert(null), 8000)
    })

    const unsubStats = p2pNetwork.onStatsUpdated((stats) => {
      setNetStats(stats)
    })

    const unsubSysSettings = p2pNetwork.onSystemSettings((newSettings) => {
      setSystemSettings(newSettings)
      voiceCall.setSystemTiming(newSettings.callRingDuration, newSettings.pageToneDuration)
      try {
        localStorage.setItem('opap_system_settings_v1', JSON.stringify(newSettings))
      } catch {}
      setBroadcastAlert(`⚙️ SYSTEM CONFIG UPDATED BY EXT 100 ADMIN`)
      setTimeout(() => setBroadcastAlert(null), 5000)
    })

    const unsubCallState = voiceCall.onCallStateChange((state, peer) => {
      setCallState(state)
      if (peer) {
        setSelected(peer)
        lastCallPeerRef.current = peer
      }
      if (
        state === 'active' ||
        state === 'calling' ||
        state === 'ringing' ||
        state === 'paging' ||
        state === 'receiving-page'
      ) {
        p2pNetwork.updateMyProfile({ status: 'busy' })
        setMyProfile(p2pNetwork.getMyProfile())
      } else if (state === 'idle' || state === 'ended') {
        p2pNetwork.updateMyProfile({ status: 'idle' })
        setMyProfile(p2pNetwork.getMyProfile())
        setIncomingCallData(null)
        setIncomingPageData(null)
        setIsMicMuted(false)

        // Log call record to chat ONCE per call session on BOTH sides
        if (callActiveSessionRef.current && !callLoggedSessionRef.current) {
          callLoggedSessionRef.current = true
          callActiveSessionRef.current = false
          if (lastCallPeerRef.current) {
            const target = lastCallPeerRef.current
            const dur = lastCallTimerRef.current
            const reason = voiceCall.getTerminationReason()

            if (dur > 0) {
              logCallToChat(target, isCallerRef.current ? 'outgoing' : 'incoming', dur)
            } else if (reason === 'declined') {
              logCallToChat(target, 'declined', 0)
            } else if (isCallerRef.current) {
              logCallToChat(target, 'outgoing', 0)
            } else {
              logCallToChat(target, 'missed', 0)
            }
            lastCallPeerRef.current = null
          }
        }
      }
    })

    const unsubIncoming = voiceCall.onIncomingCall((signal, caller) => {
      isCallerRef.current = false
      lastCallPeerRef.current = caller
      callActiveSessionRef.current = true
      callLoggedSessionRef.current = false
      setIncomingCallData({ signal, caller })
    })

    const unsubIncomingPage = voiceCall.onIncomingPage((signal, caller) => {
      lastCallPeerRef.current = caller
      setIncomingPageData({ signal, caller })
    })

    const unsubPageTimeout = voiceCall.onPageTimeout((peer, isInitiator) => {
      if (isInitiator) {
        logCallToChat(peer, 'page', 0, '🚨 Not Answered')
      } else {
        logCallToChat(peer, 'page', 0, '🚨 Missed Page')
      }
      setIncomingPageData(null)
    })

    const unsubPageResponse = voiceCall.onPageResponse((peer, type, note) => {
      if (type === 'accepted') {
        logCallToChat(peer, 'page', 0, note ? `✓ Acknowledged: "${note}"` : '✓ Acknowledged')
        setBroadcastAlert(`${peer.name.toUpperCase()} ACKNOWLEDGED PAGE`)
      } else {
        logCallToChat(peer, 'page', 0, note ? `🚫 Declined: "${note}"` : '🚫 Declined')
        setBroadcastAlert(`${peer.name.toUpperCase()} DECLINED PAGE`)
      }
      setTimeout(() => setBroadcastAlert(null), 4000)
    })

    const unsubAudio = voiceCall.onAudioLevel((level) => {
      setAudioLevel(level)
    })

    const unsubWaiting = voiceCall.onCallWaiting((signal, caller) => {
      setWaitingCall({ signal, caller })
    })

    const unsubMultiCall = voiceCall.onMultiCallChange((info) => {
      setHeldPeer(info.heldPeer)
      setIsConference(info.isConference)
      setIsHeldByRemote(info.isHeldByRemote)
      setActiveSessions(info.sessions)
      setWaitingCall(info.waitingCall)
      if (info.activePeer) {
        setSelected(info.activePeer)
        lastCallPeerRef.current = info.activePeer
      }
    })

    return () => {
      unsubPeers()
      unsubChat()
      unsubAck()
      unsubDelete()
      unsubBroadcast()
      unsubStats()
      unsubSysSettings()
      unsubCallState()
      unsubIncoming()
      unsubIncomingPage()
      unsubPageTimeout()
      unsubPageResponse()
      unsubAudio()
      unsubWaiting()
      unsubMultiCall()
    }
  }, [])

  // Auto-expand if a call or page arrives while collapsed in PiP mode
  useEffect(() => {
    if (incomingCallData || incomingPageData) {
      if (isPipMode && isPipCollapsed) {
        setIsPipCollapsed(false)
      }
    }
  }, [incomingCallData, incomingPageData, isPipMode, isPipCollapsed])

  // Force-sync React callState with the voice engine state every 300ms
  // This guarantees the caller's UI always reflects the engine state (active, calling, etc.)
  // even if a BroadcastChannel callback is delayed or missed.
  useEffect(() => {
    const syncInterval = setInterval(() => {
      const engineState = voiceCall.getCallState()
      const enginePeer = voiceCall.getCurrentPeer()
      if (engineState !== callState) {
        setCallState(engineState)
      }
      if (enginePeer && engineState !== 'idle' && engineState !== 'ended') {
        if (!selected || selected.id !== enginePeer.id) {
          setSelected(enginePeer)
        }
      }
    }, 300)
    return () => clearInterval(syncInterval)
  }, [callState, selected])

  const currentEngineState = voiceCall.getCallState()
  const effectiveCallState: CallState =
    currentEngineState !== 'idle' ? currentEngineState : callState

  const effectivePeer = voiceCall.getCurrentPeer() || selected

  const isVoiceCallActive =
    effectiveCallState === 'calling' ||
    effectiveCallState === 'active' ||
    effectiveCallState === 'ringing'

  const isPageActive =
    effectiveCallState === 'paging' ||
    effectiveCallState === 'receiving-page'

  const callActive = isVoiceCallActive || isPageActive

  const isSelectedUnassigned = Boolean(
    !selected ||
    selected.name === 'UNASSIGNED' ||
    selected.id.startsWith('unassigned-')
  )

  const isModalActive = Boolean(
    showRegistration ||
    incomingCallData ||
    incomingPageData ||
    waitingCall ||
    showBroadcastModal ||
    showSettingsModal
  )

  const handleCancelPage = () => {
    sound.playKeyClick()
    const es = voiceCall.getCallState()
    if (es === 'paging' || callState === 'paging') {
      voiceCall.cancelPage()
    } else if (es === 'receiving-page' || callState === 'receiving-page') {
      handleDeclinePage('')
    }
  }

  const handleDial = (peer: Peer) => {
    if (peer.id === myProfile.id || peer.ext === myProfile.ext) return
    // GSM Rule: If clicking the held peer, swap to it
    if (heldPeer && (peer.id === heldPeer.id || peer.ext === heldPeer.ext)) {
      voiceCall.swapCalls()
      return
    }
    setSelected((prev) => (prev?.id === peer.id ? null : peer))
  }

  const handleCall = () => {
    sound.playKeyClick()
    if (!selected) return
    if (selected.id === myProfile.id || selected.ext === myProfile.ext) return

    if (selected.name === 'UNASSIGNED' || selected.id.startsWith('unassigned-')) {
      sound.playDisconnectTone()
      setBroadcastAlert(`EXT ${selected.ext} UNASSIGNED - CANNOT CALL`)
      setTimeout(() => setBroadcastAlert(null), 3000)
      return
    }

    // GSM Rule: If already on a call, dialing puts active call on hold
    isCallerRef.current = true
    lastCallPeerRef.current = selected
    callActiveSessionRef.current = true
    callLoggedSessionRef.current = false
    setCallState('calling')
    voiceCall.initiateCall(selected)
  }

  const handleCallSpecificPeer = (targetPeer: Peer) => {
    sound.playKeyClick()
    if (targetPeer.id === myProfile.id || targetPeer.ext === myProfile.ext) return

    if (targetPeer.name === 'UNASSIGNED' || targetPeer.id.startsWith('unassigned-')) {
      sound.playDisconnectTone()
      setBroadcastAlert(`EXT ${targetPeer.ext} UNASSIGNED - CANNOT CALL`)
      setTimeout(() => setBroadcastAlert(null), 3000)
      return
    }

    isCallerRef.current = true
    lastCallPeerRef.current = targetPeer
    callActiveSessionRef.current = true
    callLoggedSessionRef.current = false
    setSelected(targetPeer)
    setCallState('calling')
    voiceCall.initiateCall(targetPeer)
  }

  // Direct Pager Alert / PA Page Handler
  const handlePage = () => {
    sound.playKeyClick()
    if (callActive) return

    if (selected) {
      if (selected.id === myProfile.id || selected.ext === myProfile.ext) return

      if (selected.name === 'UNASSIGNED' || selected.id.startsWith('unassigned-')) {
        sound.playDisconnectTone()
        setBroadcastAlert(`EXT ${selected.ext} UNASSIGNED - CANNOT PAGE`)
        setTimeout(() => setBroadcastAlert(null), 3000)
        return
      }

      isCallerRef.current = true
      lastCallPeerRef.current = selected
      voiceCall.initiatePage(selected)
    } else {
      // If broadcast is restricted to EXT 100 Admin
      if (systemSettings.broadcastPermission === 'admin-only' && myProfile.ext !== '100') {
        sound.playDisconnectTone()
        setBroadcastAlert('PA BROADCAST RESTRICTED TO EXT 100 ADMIN')
        setTimeout(() => setBroadcastAlert(null), 4000)
        return
      }
      setShowBroadcastModal(true)
    }
  }

  const handleAcknowledgePage = (text: string) => {
    sound.playKeyClick()
    if (!incomingPageData) return
    const { caller } = incomingPageData
    voiceCall.acceptIncomingPage(text)

    // Save only the single down-log style pill badge
    logCallToChat(caller, 'page', 0, text ? `✓ Acknowledged: "${text}"` : '✓ Acknowledged')

    setBroadcastAlert(`ACK SENT TO ${caller.name.toUpperCase()}`)
    setTimeout(() => setBroadcastAlert(null), 4000)
    setIncomingPageData(null)
  }

  const handleDeclinePage = (text: string) => {
    sound.playKeyClick()
    if (!incomingPageData) return
    const { caller } = incomingPageData
    voiceCall.declineIncomingPage(text)

    // Save only the single down-log style pill badge
    logCallToChat(caller, 'page', 0, text ? `🚫 Declined: "${text}"` : '🚫 Declined')

    setBroadcastAlert(`DECLINED PAGE FROM ${caller.name.toUpperCase()}`)
    setTimeout(() => setBroadcastAlert(null), 4000)
    setIncomingPageData(null)
  }

  const handleAcceptIncomingCall = useCallback(() => {
    if (incomingCallData) {
      sound.stopAllCallTones()
      voiceCall.acceptIncomingCall(incomingCallData.signal, incomingCallData.caller)
      setIncomingCallData(null)
    }
  }, [incomingCallData])

  const handleDeclineIncomingCall = useCallback(() => {
    if (incomingCallData) {
      sound.stopAllCallTones()
      voiceCall.rejectIncomingCall()
      setIncomingCallData(null)
    }
  }, [incomingCallData])

  const handleDismissIncomingPage = () => {
    if (incomingPageData) {
      const { caller } = incomingPageData
      voiceCall.declineIncomingPage()
      logCallToChat(caller, 'page', 0, '🚨 Missed Page')
      setIncomingPageData(null)
    }
  }

  const handleEnd = () => {
    sound.playKeyClick()
    const engineState = voiceCall.getCallState()
    if (incomingCallData) setIncomingCallData(null)
    if (incomingPageData) setIncomingPageData(null)
    setCandidateToAdd(null)
    setShowAddMenu(false)

    if (engineState === 'paging' || callState === 'paging') {
      voiceCall.cancelPage()
    } else if (engineState === 'receiving-page' || callState === 'receiving-page') {
      handleDeclinePage('')
    } else if (
      engineState === 'active' ||
      engineState === 'calling' ||
      engineState === 'ringing' ||
      callActive
    ) {
      voiceCall.endCall()
    } else {
      setChatMode(false)
      setSelected(null)
    }
  }

  // 1. Calculate total unread messages count across all chats (strictly received text/audio messages from peers, never sent by self)
  const unreadMsgCount = useMemo(() => {
    let count = 0
    const seenMsgIds = new Set<string>()
    const myId = String(myProfile.id).trim()
    const myExt = String(myProfile.ext).trim()

    Object.values(chats).forEach((msgList) => {
      msgList.forEach((m) => {
        const isFromMyself =
          m.from === 'me' ||
          String(m.senderId).trim() === myId ||
          String(m.senderExt).trim() === myExt

        const isUnreadMsg =
          !isFromMyself &&
          m.from === 'them' &&
          m.type !== 'call-log' &&
          m.status !== 'read' &&
          !m.isDeleted

        if (isUnreadMsg && !seenMsgIds.has(m.id)) {
          seenMsgIds.add(m.id)
          count++
        }
      })
    })
    return count
  }, [chats, myProfile.id, myProfile.ext])

  // 2. Calculate total unread voice call logs count (strictly missed/incoming voice calls received from peers)
  const unreadCallCount = useMemo(() => {
    let count = 0
    const seenMsgIds = new Set<string>()
    const myId = String(myProfile.id).trim()
    const myExt = String(myProfile.ext).trim()

    Object.values(chats).forEach((msgList) => {
      msgList.forEach((m) => {
        const isFromMyself =
          m.from === 'me' ||
          String(m.senderId).trim() === myId ||
          String(m.senderExt).trim() === myExt

        const isUnreadCall =
          !isFromMyself &&
          m.from === 'them' &&
          m.type === 'call-log' &&
          m.callType !== 'page' &&
          m.status !== 'read' &&
          !m.isDeleted

        if (isUnreadCall && !seenMsgIds.has(m.id)) {
          seenMsgIds.add(m.id)
          count++
        }
      })
    })
    return count
  }, [chats, myProfile.id, myProfile.ext])

  // 3. Calculate total unread pager alerts count (strictly incoming pager alerts received from peers)
  const unreadPageCount = useMemo(() => {
    let count = 0
    const seenMsgIds = new Set<string>()
    const myId = String(myProfile.id).trim()
    const myExt = String(myProfile.ext).trim()

    Object.values(chats).forEach((msgList) => {
      msgList.forEach((m) => {
        const isFromMyself =
          m.from === 'me' ||
          String(m.senderId).trim() === myId ||
          String(m.senderExt).trim() === myExt

        const isUnreadPage =
          !isFromMyself &&
          m.from === 'them' &&
          m.type === 'call-log' &&
          m.callType === 'page' &&
          m.status !== 'read' &&
          !m.isDeleted

        if (isUnreadPage && !seenMsgIds.has(m.id)) {
          seenMsgIds.add(m.id)
          count++
        }
      })
    })
    return count
  }, [chats, myProfile.id, myProfile.ext])

  // 4. Calculate available online LAN peers that can be added to the active call
  const availablePeersToAdd = useMemo(() => {
    const inCallExts = new Set<string>()
    if (myProfile?.ext) inCallExts.add(String(myProfile.ext).trim())
    if (selected?.ext) inCallExts.add(String(selected.ext).trim())
    if (heldPeer?.ext) inCallExts.add(String(heldPeer.ext).trim())
    activeSessions.forEach((s) => {
      if (s.peer?.ext) inCallExts.add(String(s.peer.ext).trim())
    })
    return peers.filter(
      (p) =>
        !inCallExts.has(String(p.ext).trim()) &&
        p.name !== 'UNASSIGNED' &&
        !p.id.startsWith('unassigned-') &&
        p.id !== myProfile.id &&
        p.ext !== myProfile.ext
    )
  }, [peers, myProfile, selected, heldPeer, activeSessions])

  // Mark all incoming messages in a room as read across all dictionary keys
  const handleMarkRoomAsRead = (peer: Peer) => {
    if (!peer) return
    const peerExtStr = String(peer.ext).trim()
    const peerIdStr = String(peer.id).trim()

    setChats((prev) => {
      let changed = false
      const next = { ...prev }
      Object.keys(next).forEach((k) => {
        next[k] = next[k].map((m) => {
          const isFromTarget =
            String(m.senderId).trim() === peerIdStr ||
            String(m.senderExt).trim() === peerExtStr ||
            String(m.targetId).trim() === peerIdStr ||
            String(m.targetExt).trim() === peerExtStr

          if (isFromTarget && m.from === 'them' && m.status !== 'read') {
            changed = true
            return { ...m, status: 'read' as const }
          }
          return m
        })
      })
      return changed ? next : prev
    })
  }

  // Toggle MSG tab ON/OFF
  const handleMsgToggle = () => {
    sound.playKeyClick()
    setChatMode((prev) => {
      const next = !prev
      if (next && selected) {
        handleMarkRoomAsRead(selected)
      }
      return next
    })
  }

  const handleSendMessage = (targetPeer: Peer, text: string, audioData?: string) => {
    if (!targetPeer || targetPeer.id === myProfile.id || targetPeer.ext === myProfile.ext) return
    if (targetPeer.name === 'UNASSIGNED' || targetPeer.id.startsWith('unassigned-')) {
      setBroadcastAlert(`EXT ${targetPeer.ext} UNASSIGNED - CANNOT MESSAGE`)
      setTimeout(() => setBroadcastAlert(null), 3000)
      return
    }

    const msg = p2pNetwork.sendChatMessage(
      targetPeer.id,
      targetPeer.ext,
      text,
      audioData ? 'voice' : 'text',
      audioData
    )

    saveMessageToChats(msg, targetPeer)
  }

  const handleBroadcast = (text: string) => {
    const ann = p2pNetwork.sendBroadcastPage(text)
    setBroadcastAlert(`ME (PA): ${ann.text}`)
    setBroadcastHistory((prev) => [...prev, ann])
    setTimeout(() => setBroadcastAlert(null), 7000)
  }

  const cycleMyStatus = () => {
    sound.playKeyClick()
    const nextIdx = (STATUS_CYCLE.indexOf(myProfile.status) + 1) % STATUS_CYCLE.length
    const nextStatus = STATUS_CYCLE[nextIdx]
    p2pNetwork.updateMyProfile({ status: nextStatus })
    setMyProfile(p2pNetwork.getMyProfile())
  }

  const handleUpdateProfile = (updates: Partial<Pick<Peer, 'name' | 'full' | 'ext' | 'status'>>) => {
    p2pNetwork.updateMyProfile(updates)
    setMyProfile(p2pNetwork.getMyProfile())
  }

  const handleUpdateSystemSettings = (newSettings: SystemSettings) => {
    setSystemSettings(newSettings)
    voiceCall.setSystemTiming(newSettings.callRingDuration, newSettings.pageToneDuration)
    try {
      localStorage.setItem('opap_system_settings_v1', JSON.stringify(newSettings))
    } catch {}
    p2pNetwork.broadcastSystemSettings(newSettings)
  }

  const handleCompleteRegistration = (profile: { name: string; full: string; ext: string; status: Status }) => {
    try {
      localStorage.setItem('opap_registered', 'true')
    } catch {}
    handleUpdateProfile(profile)
    setShowRegistration(false)
  }

  const occupiedExts = peers.map((p) => p.ext)

  return (
    <div
      style={{
        background: '#09090f',
        backgroundImage: 'radial-gradient(#1c1c2e 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px 12px',
        boxSizing: 'border-box',
        color: '#e2e8f0',
        fontFamily: 'Inter, system-ui, sans-serif',
        position: 'relative',
        overflowX: 'hidden',
      }}
    >
      {/* Background ambient lighting */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: '450px',
          height: '450px',
          background: 'radial-gradient(circle, rgba(56,56,120,0.16) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Main OPAP Mobile Station Container */}
      <div
        ref={mainStationRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          width: '100%',
          maxWidth: '300px',
          position: isPipMode ? 'fixed' : 'relative',
          top: isPipMode ? '50%' : undefined,
          right: isPipMode ? (isPipCollapsed ? '-360px' : '0px') : undefined,
          transform: isPipMode ? 'translateY(-50%)' : undefined,
          zIndex: isPipMode ? 99990 : undefined,
          pointerEvents: (isPipMode && isPipCollapsed) ? 'none' : 'auto',
          transition: 'right 0.38s cubic-bezier(0.16, 1, 0.3, 1), transform 0.38s ease',
        }}
      >
        {/* ── THE PAGER HARDWARE UNIT (TEMPLATE) ── */}
        <div
          style={{
            width: '100%',
            background: 'linear-gradient(160deg, #242436 0%, #161622 55%, #1d1d2b 100%)',
            borderRadius: isPipMode ? '16px 0 0 16px' : '16px',
            padding: '12px 14px 12px',
            boxShadow: isPipMode
              ? (isPipCollapsed ? 'none' : '-8px 0 45px rgba(0,0,0,0.92), 0 0 0 1.5px #34344e, inset 0 1px 0 #3e3e5c')
              : '0 0 0 1.5px #34344e, 0 20px 60px rgba(0,0,0,0.85), inset 0 1px 0 #3e3e5c',
            borderRight: isPipMode ? 'none' : undefined,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* ── INITIAL SELF-REGISTRATION MODAL ── */}
          {showRegistration && (
            <RegistrationModal
              myProfile={myProfile}
              occupiedExts={occupiedExts}
              masterPin={systemSettings.masterPin}
              onCompleteRegistration={handleCompleteRegistration}
            />
          )}

          {/* ── 1. CLEAN INTEGRATED HEADER BAR ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
              paddingBottom: '8px',
              borderBottom: '1px solid #2a2a3e',
              pointerEvents: isModalActive ? 'none' : 'auto',
            }}
          >
            {/* Left: Status LED + Title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                onClick={cycleMyStatus}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
                title="Tap to change your status"
              >
                <div
                  style={{
                    width: '9px',
                    height: '9px',
                    borderRadius: '50%',
                    background: callActive || effectiveCallState === 'active' ? '#ef4444' : STATUS_COLOR[myProfile.status] || '#22c55e',
                    boxShadow: `0 0 8px ${callActive || effectiveCallState === 'active' ? '#ef4444' : STATUS_COLOR[myProfile.status] || '#22c55e'}`,
                    animation: callActive || effectiveCallState === 'active' ? 'pulse-dot 1s ease-in-out infinite' : 'pulse-dot 2s ease-in-out infinite',
                  }}
                />
              </button>

              <div>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#fff',
                    letterSpacing: '0.06em',
                    lineHeight: 1.1,
                  }}
                >
                  {systemSettings.systemName || 'OPAP MOBILE INTERCOM'}
                </div>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '7px',
                    color: effectiveCallState === 'active' ? '#f87171' : callActive ? '#f87171' : STATUS_COLOR[myProfile.status] || '#22c55e',
                    letterSpacing: '0.05em',
                    fontWeight: effectiveCallState === 'active' || callActive ? 700 : 500,
                  }}
                >
                  {effectiveCallState === 'active'
                    ? `🔴 IN CALL (${effectivePeer ? `EXT ${effectivePeer.ext}` : 'ACTIVE'})`
                    : effectiveCallState === 'calling'
                    ? `📞 CALLING (EXT ${effectivePeer?.ext || '---'})`
                    : effectiveCallState === 'ringing'
                    ? `📲 INCOMING (EXT ${effectivePeer?.ext || '---'})`
                    : effectiveCallState === 'paging'
                    ? `🚨 PAGING EXT ${effectivePeer?.ext || '---'}`
                    : effectiveCallState === 'receiving-page'
                    ? `🚨 RECEIVING PAGE`
                    : `${STATUS_LABEL[myProfile.status]} · EXT ${myProfile.ext}`}
                </div>
              </div>
            </div>

            {/* Right: PiP Controls & LAN Settings Button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {isPipMode ? (
                <>
                  <button
                    type="button"
                    onClick={handleTogglePipCollapse}
                    title="Hide / Dock to right screen edge"
                    style={{
                      background: '#151528',
                      border: '1px solid #3b82f6',
                      borderRadius: '5px',
                      padding: '3px 6px',
                      fontSize: '8px',
                      color: '#93c5fd',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      fontWeight: 700,
                    }}
                  >
                    <span>▶</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>DOCK</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleTogglePipMode}
                    title="Exit PiP mode to screen center"
                    style={{
                      background: '#1a1a2e',
                      border: '1px solid #3b3b55',
                      borderRadius: '5px',
                      padding: '3px 5px',
                      fontSize: '8px',
                      color: '#cbd5e1',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <span>⤢</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleTogglePipMode}
                  title="Enter PiP Mode (Dock to Right Screen Edge)"
                  style={{
                    background: '#1a1a2e',
                    border: '1px solid #3b3b55',
                    borderRadius: '5px',
                    padding: '3px 6px',
                    fontSize: '8px',
                    color: '#60a5fa',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    fontWeight: 600,
                  }}
                >
                  <span>⧉</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '7.5px' }}>PiP</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  sound.playKeyClick()
                  setShowSettingsModal(true)
                }}
                title="LAN Network & Diagnostics"
                style={{
                  background: '#1a1a2e',
                  border: '1px solid #3b3b55',
                  borderRadius: '5px',
                  padding: '3px 6px',
                  fontSize: '8.5px',
                  color: '#60a5fa',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <span>⚙️</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: '8px' }}>LAN</span>
              </button>
            </div>
          </div>

          {/* ── 2. UNIFIED DISPLAY & DIALER VIEWPORT (DIALER PADS EXPANDED WITH EQUAL 8PX GAPS) ── */}
          <div style={{ position: 'relative', overflow: 'hidden', height: '280px', marginBottom: '8px' }}>
            {/* Stationary Base Layer: LCD Screen (top) + 3x3 Dialer Grid (bottom) */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                pointerEvents: (chatMode || isModalActive) ? 'none' : 'auto',
                transition: 'opacity 0.28s ease, transform 0.28s ease',
                opacity: chatMode ? 0.15 : 1,
                transform: chatMode ? 'scale(0.97)' : 'scale(1)',
              }}
            >
              {/* LCD Screen */}
              <LcdScreen
                clock={clock}
                myStatus={myProfile.status}
                myExt={myProfile.ext}
                selected={effectivePeer}
                callState={effectiveCallState}
                callTimer={callTimer}
                audioLevel={audioLevel}
                broadcastAlert={broadcastAlert}
                peerCount={netStats.peerCount}
                systemName={systemSettings.systemName}
                pageToneDuration={systemSettings.pageToneDuration}
                volume={appVolume}
                onVolumeChange={handleVolumeChange}
                isMuted={isMicMuted}
                onToggleMuteMic={handleToggleMuteMic}
                heldPeer={heldPeer}
                isConference={isConference}
                isHeldByRemote={isHeldByRemote}
                activeCallCount={activeSessions.length}
                candidatePeer={candidateToAdd}
              />

              {/* 3x3 Dialer Grid (Strict slots 1 to 9 mapped to EXT 101 to 109) */}
              <div style={{ flex: 1 }}>
                <DialerGrid
                  peers={peers}
                  myProfile={myProfile}
                  selected={effectivePeer}
                  callActive={callActive}
                  callState={effectiveCallState}
                  heldPeer={heldPeer}
                  isConference={isConference}
                  candidatePeer={candidateToAdd}
                  onSelectPeer={handleDial}
                  onSwapCalls={() => voiceCall.swapCalls()}
                  onSelectCandidate={(peer) => {
                    if (!peer || peer.name === 'UNASSIGNED' || peer.id.startsWith('unassigned-')) {
                      sound.playDisconnectTone()
                      setBroadcastAlert(`EXT ${peer?.ext || ''} UNASSIGNED - CANNOT ADD TO CALL`)
                      setTimeout(() => setBroadcastAlert(null), 3000)
                      return
                    }
                    setCandidateToAdd(peer)
                    setShowAddMenu(true)
                  }}
                />
              </div>
            </div>

            {/* Internal Modals (Original Sizing inside Viewport) */}
            {waitingCall && (
              <CallWaitingModal
                caller={waitingCall.caller}
                signal={waitingCall.signal}
                onHoldAndAnswer={() => voiceCall.holdAndAnswer(waitingCall.signal, waitingCall.caller)}
                onEndAndAnswer={() => voiceCall.endAndAnswer(waitingCall.signal, waitingCall.caller)}
                onDecline={() => voiceCall.declineWaitingCall()}
              />
            )}

            {incomingCallData && (
              <IncomingCallModal
                caller={incomingCallData.caller}
                signal={incomingCallData.signal}
                callRingDuration={incomingCallData.signal.callRingDuration || systemSettings.callRingDuration}
                onAccept={handleAcceptIncomingCall}
                onDecline={handleDeclineIncomingCall}
              />
            )}

            {incomingPageData && (
              <IncomingPageModal
                caller={incomingPageData.caller}
                signal={incomingPageData.signal}
                pageToneDuration={incomingPageData.signal.pageToneDuration ?? systemSettings.pageToneDuration}
                onAcknowledge={handleAcknowledgePage}
                onDecline={handleDeclinePage}
                onDismiss={handleDismissIncomingPage}
              />
            )}

            {showBroadcastModal && (
              <BroadcastModal
                onBroadcast={handleBroadcast}
                onClose={() => setShowBroadcastModal(false)}
              />
            )}

            {showSettingsModal && (
              <NetworkSettingsModal
                myProfile={myProfile}
                stats={netStats}
                occupiedExts={occupiedExts}
                systemSettings={systemSettings}
                isSimulatedEnabled={p2pNetwork.isSimulatedPeersEnabled()}
                isSoundMuted={isSoundMuted}
                onUpdateProfile={handleUpdateProfile}
                onUpdateSystemSettings={handleUpdateSystemSettings}
                onToggleSimulated={(enabled) => p2pNetwork.toggleSimulatedPeers(enabled)}
                onToggleMute={(muted) => {
                  sound.setMuted(muted)
                  setIsSoundMuted(muted)
                }}
                onClose={() => setShowSettingsModal(false)}
              />
            )}
          </div>

          {/* GSM Multi-Call & Add Participant Controls (Active Callers) */}
          {(effectiveCallState === 'active' || (isVoiceCallActive && effectiveCallState !== 'calling' && effectiveCallState !== 'ringing')) && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                marginBottom: '8px',
              }}
            >
              {/* 1. Candidate is chosen: prompt user to choose Standby vs Group Conference */}
              {candidateToAdd && candidateToAdd.name !== 'UNASSIGNED' && !candidateToAdd.id.startsWith('unassigned-') ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '8px 10px',
                    background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.96) 0%, rgba(8, 12, 24, 0.98) 100%)',
                    border: '1.5px solid #38bdf8',
                    borderRadius: '8px',
                    boxShadow: '0 0 14px rgba(56, 189, 248, 0.35)',
                    animation: 'fadeIn 0.15s ease',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '9px',
                        fontWeight: 800,
                        color: '#38bdf8',
                        letterSpacing: '0.04em',
                      }}
                    >
                      ➕ ADD EXT {candidateToAdd.ext} ({candidateToAdd.name.toUpperCase()})
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        sound.playKeyClick()
                        setCandidateToAdd(null)
                        setShowAddMenu(false)
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#94a3b8',
                        fontSize: '11px',
                        cursor: 'pointer',
                        padding: '0 4px',
                        fontWeight: 800,
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    {/* Standby Call: Holds active call, dials new participant */}
                    <button
                      type="button"
                      onClick={() => {
                        sound.playKeyClick()
                        voiceCall.addParticipant(candidateToAdd, 'standby')
                        setCandidateToAdd(null)
                        setShowAddMenu(false)
                      }}
                      title="Place current call on standby and call this party"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        padding: '6px 4px',
                        borderRadius: '6px',
                        border: '1.5px solid #f59e0b',
                        background: 'linear-gradient(180deg, #d97706 0%, #b45309 100%)',
                        color: '#ffffff',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '8px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        boxShadow: '0 2px 6px rgba(245, 158, 11, 0.4)',
                      }}
                    >
                      <span>⏸️</span>
                      <span>HOLD & CALL</span>
                    </button>

                    {/* Group Conference: Dials directly into conference */}
                    <button
                      type="button"
                      onClick={() => {
                        sound.playKeyClick()
                        voiceCall.addParticipant(candidateToAdd, 'conference')
                        setCandidateToAdd(null)
                        setShowAddMenu(false)
                      }}
                      title="Add party directly into group conference"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        padding: '6px 4px',
                        borderRadius: '6px',
                        border: '1.5px solid #c084fc',
                        background: 'linear-gradient(180deg, #9333ea 0%, #7e22ce 100%)',
                        color: '#ffffff',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '8px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        boxShadow: '0 2px 6px rgba(192, 132, 252, 0.4)',
                      }}
                    >
                      <span>👥</span>
                      <span>ADD TO GROUP</span>
                    </button>
                  </div>
                </div>
              ) : showAddMenu ? (
                /* 2. Quick Participant Picker */
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    padding: '6px 8px',
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    borderRadius: '8px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '8px',
                      color: '#94a3b8',
                      fontWeight: 700,
                    }}
                  >
                    <span>TAP KEYPAD SLOT OR SELECT UNIT:</span>
                    <button
                      type="button"
                      onClick={() => setShowAddMenu(false)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#94a3b8',
                        fontSize: '10px',
                        cursor: 'pointer',
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {availablePeersToAdd.length > 0 ? (
                      availablePeersToAdd.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            sound.playKeyClick()
                            setCandidateToAdd(p)
                          }}
                          style={{
                            padding: '3px 6px',
                            borderRadius: '4px',
                            border: '1px solid #38bdf8',
                            background: '#0c2b42',
                            color: '#e0f2fe',
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: '8px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          EXT {p.ext} ({p.name})
                        </button>
                      ))
                    ) : (
                      <span
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: '8px',
                          color: '#64748b',
                        }}
                      >
                        All online units already in call. Tap any keypad slot (1-9) to dial custom ext.
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                /* 3. Primary In-Call Toolbar: SWAP, MERGE, ADD PARTICIPANT */
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '5px 8px',
                    background: 'rgba(15, 23, 42, 0.9)',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    borderRadius: '8px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                  }}
                >
                  {/* Swap Button (If held peer exists) */}
                  {heldPeer && !isConference && (
                    <button
                      type="button"
                      onClick={() => voiceCall.swapCalls()}
                      title="Swap between active and held calls"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        border: '1.5px solid #38bdf8',
                        background: 'linear-gradient(180deg, #0284c7 0%, #0369a1 100%)',
                        color: '#ffffff',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '8px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        boxShadow: '0 0 8px rgba(56, 189, 248, 0.4)',
                      }}
                    >
                      <span>🔄</span>
                      <span>SWAP ({heldPeer.ext})</span>
                    </button>
                  )}

                  {/* Merge Button (If held peer exists) */}
                  {heldPeer && !isConference && (
                    <button
                      type="button"
                      onClick={() => voiceCall.mergeCalls()}
                      title="Merge active and held calls into 3-way conference"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        border: '1.5px solid #c084fc',
                        background: 'linear-gradient(180deg, #9333ea 0%, #7e22ce 100%)',
                        color: '#ffffff',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '8px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        boxShadow: '0 0 8px rgba(192, 132, 252, 0.4)',
                      }}
                    >
                      <span>👥</span>
                      <span>MERGE (CONF)</span>
                    </button>
                  )}

                  {/* Add Participant Button (Always available to active callers) */}
                  <button
                    type="button"
                    onClick={() => {
                      sound.playKeyClick()
                      setShowAddMenu(true)
                    }}
                    title="Add another participant as Standby or Group call"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: '1.5px solid #22c55e',
                      background: 'linear-gradient(180deg, #16a34a 0%, #15803d 100%)',
                      color: '#ffffff',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '8px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '0 0 8px rgba(34, 197, 94, 0.4)',
                    }}
                  >
                    <span>➕</span>
                    <span>ADD CALL</span>
                  </button>

                  {isConference && (
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '7.5px',
                        fontWeight: 800,
                        color: '#c084fc',
                        letterSpacing: '0.04em',
                      }}
                    >
                      👥 CONF ({activeSessions.length + 1})
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── 3. REARRANGED ACTION BUTTONS: [CALL/END (Left -25%)] | [PAGE (Center +50% Circle)] | [MSG (Right -25%)] ── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              gap: '8px',
              alignItems: 'center',
              pointerEvents: (isModalActive && !isVoiceCallActive) ? 'none' : 'auto',
            }}
          >
            {/* 1. LEFT: CALL / END SMART TOGGLE BUTTON (Activates strictly for voice calls) */}
            {isVoiceCallActive ? (
              <button
                type="button"
                onClick={handleEnd}
                title="Disconnect active call"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  padding: '7px 2px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: '2px solid #f87171',
                  background: 'linear-gradient(180deg, #ef4444 0%, #dc2626 100%)',
                  boxShadow: '0 0 14px rgba(239,68,68,0.6), inset 0 1px 0 rgba(255,255,255,0.3)',
                  transition: 'all 0.15s ease',
                  outline: 'none',
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-2.67m-2.67-3.34a19.79 19.79 0 01-3.07-8.63A2 2 0 014 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91" />
                  <line x1="23" y1="1" x2="1" y2="23" />
                </svg>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '7.5px',
                    letterSpacing: '0.08em',
                    color: '#ffffff',
                    fontWeight: 700,
                    lineHeight: 1,
                  }}
                >
                  END
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCall}
                disabled={isSelectedUnassigned}
                title={
                  isSelectedUnassigned
                    ? selected
                      ? `EXT ${selected.ext} is Unassigned (Cannot call)`
                      : 'Select an extension to call'
                    : `Call ${selected.name}`
                }
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  padding: '7px 2px',
                  borderRadius: '8px',
                  cursor: isSelectedUnassigned ? 'not-allowed' : 'pointer',
                  opacity: isSelectedUnassigned ? 0.45 : 1,
                  border: !isSelectedUnassigned
                    ? '1.5px solid #22c55e'
                    : '1.5px solid #334155',
                  background: !isSelectedUnassigned
                    ? 'linear-gradient(180deg, #16a34a 0%, #15803d 100%)'
                    : 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
                  boxShadow: !isSelectedUnassigned
                    ? '0 2px 10px rgba(34,197,94,0.4), inset 0 1px 0 rgba(255,255,255,0.2)'
                    : 'none',
                  transition: 'all 0.15s ease',
                  outline: 'none',
                }}
              >
                {/* Unread Call Logs Badge on CALL button */}
                {unreadCallCount > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '-4px',
                      right: '-4px',
                      minWidth: '14px',
                      height: '14px',
                      padding: '0 3px',
                      borderRadius: '7px',
                      background: 'linear-gradient(180deg, #ef4444 0%, #dc2626 100%)',
                      border: '1.5px solid #ffffff',
                      color: '#ffffff',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '7px',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 8px rgba(239, 68, 68, 0.8), 0 0 10px rgba(239, 68, 68, 0.6)',
                      animation: 'pulse 1.5s ease-in-out infinite',
                      zIndex: 10,
                    }}
                  >
                    {unreadCallCount > 99 ? '99+' : unreadCallCount}
                  </div>
                )}

                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.09 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                </svg>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '7.5px',
                    letterSpacing: '0.08em',
                    color: '#ffffff',
                    fontWeight: 700,
                    lineHeight: 1,
                  }}
                >
                  CALL
                </span>
              </button>
            )}

            {/* 2. MIDDLE: PAGE BUTTON (+50% Larger Tactical Circular Button with Active WiFi Loading Signal / Vibrating Bell) */}
            <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              {/* Unread Pager Alerts Badge on PAGE button */}
              {unreadPageCount > 0 && !isPageActive && (
                <div
                  style={{
                    position: 'absolute',
                    top: '-2px',
                    right: '-2px',
                    minWidth: '16px',
                    height: '16px',
                    padding: '0 3.5px',
                    borderRadius: '8px',
                    background: 'linear-gradient(180deg, #ef4444 0%, #dc2626 100%)',
                    border: '1.5px solid #ffffff',
                    color: '#ffffff',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '7.5px',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(239, 68, 68, 0.8), 0 0 10px rgba(239, 68, 68, 0.6)',
                    animation: 'pulse 1.5s ease-in-out infinite',
                    zIndex: 10,
                  }}
                >
                  {unreadPageCount > 99 ? '99+' : unreadPageCount}
                </div>
              )}

              {isPageActive && (
                <div
                  style={{
                    position: 'absolute',
                    width: '74px',
                    height: '74px',
                    borderRadius: '50%',
                    border: '2px solid transparent',
                    borderTopColor: callState === 'receiving-page' ? '#ef4444' : '#fbbf24',
                    borderRightColor: callState === 'receiving-page' ? '#f59e0b' : '#f59e0b',
                    animation: 'signal-spinner 0.8s linear infinite',
                    pointerEvents: 'none',
                    zIndex: 1,
                  }}
                />
              )}
              <button
                type="button"
                onClick={
                  callState === 'receiving-page'
                    ? () => handleAcknowledgePage('')
                    : isPageActive
                    ? handleCancelPage
                    : handlePage
                }
                title={
                  callState === 'receiving-page'
                    ? 'Incoming Pager Alert - Tap to Acknowledge'
                    : isPageActive
                    ? 'Active Paging Broadcast - Tap to Cancel'
                    : selected && selected.name !== 'UNASSIGNED'
                    ? `Send direct pager beep to ${selected.name} (EXT ${selected.ext})`
                    : 'Broadcast PA announcement to all stations'
                }
                style={{
                  width: '68px',
                  height: '68px',
                  borderRadius: '50%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: isPageActive ? '0px' : '2.5px',
                  padding: 0,
                  cursor: 'pointer',
                  border:
                    callState === 'receiving-page'
                      ? '2.5px solid #f87171'
                      : isPageActive
                      ? '2.5px solid #f59e0b'
                      : '2.5px solid #fbbf24',
                  background:
                    callState === 'receiving-page'
                      ? 'linear-gradient(180deg, #ef4444 0%, #dc2626 50%, #b91c1c 100%)'
                      : isPageActive
                      ? 'linear-gradient(180deg, #f59e0b 0%, #ea580c 50%, #c2410c 100%)'
                      : selected && selected.name !== 'UNASSIGNED'
                      ? 'linear-gradient(180deg, #f59e0b 0%, #ea580c 55%, #c2410c 100%)'
                      : 'linear-gradient(180deg, #d97706 0%, #b45309 55%, #92400e 100%)',
                  boxShadow:
                    callState === 'receiving-page'
                      ? '0 0 20px rgba(239,68,68,0.8), inset 0 2px 4px rgba(255,255,255,0.5)'
                      : isPageActive
                      ? '0 0 16px rgba(245,158,11,0.7), inset 0 2px 4px rgba(255,255,255,0.45)'
                      : selected && selected.name !== 'UNASSIGNED'
                      ? '0 0 18px rgba(245,158,11,0.65), inset 0 2px 3px rgba(255,255,255,0.45), inset 0 -3px 4px rgba(0,0,0,0.5)'
                      : '0 3px 10px rgba(0,0,0,0.7), inset 0 2px 2px rgba(255,255,255,0.35), inset 0 -2px 3px rgba(0,0,0,0.4)',
                  transition: 'all 0.15s ease',
                  outline: 'none',
                  userSelect: 'none',
                  position: 'relative',
                  zIndex: 2,
                }}
              >
                {callState === 'receiving-page' ? (
                  /* Receiver: Shaking / Vibrating Alert Bell */
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="#ffffff"
                    stroke="#ffffff"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ animation: 'bell-shake 0.45s ease-in-out infinite' }}
                  >
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                ) : callState === 'paging' ? (
                  /* Sender: Sequential Loading Signal Waves (Cleanly Centered, No text below) */
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {/* Center Dot */}
                    <circle cx="12" cy="20" r="1.5" fill="#ffffff" style={{ animation: 'signal-load-dot 1.2s infinite' }} />
                    {/* Inner Arc */}
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" stroke="#ffffff" style={{ animation: 'signal-load-arc1 1.2s infinite' }} />
                    {/* Middle Arc */}
                    <path d="M5 12.55a11 11 0 0 1 14.08 0" stroke="#ffffff" style={{ animation: 'signal-load-arc2 1.2s infinite' }} />
                    {/* Outer Arc */}
                    <path d="M1.42 9a16 16 0 0 1 21.16 0" stroke="#ffffff" style={{ animation: 'signal-load-arc3 1.2s infinite' }} />
                  </svg>
                ) : (
                  /* Standard Pager Megaphone Icon (Standby) with PAGE label */
                  <>
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M11 5L6 9H2v6h4l5 4V5z" />
                      <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
                    </svg>
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '9.5px',
                        letterSpacing: '0.09em',
                        color: '#ffffff',
                        fontWeight: 800,
                        lineHeight: 1,
                      }}
                    >
                      PAGE
                    </span>
                  </>
                )}
              </button>
            </div>

            {/* 3. RIGHT: MSG BUTTON (25% More Compact Toggle) */}
            <button
              type="button"
              onClick={handleMsgToggle}
              title={chatMode ? 'Close MSG rooms tab' : 'Open MSG rooms tab'}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2px',
                padding: '7px 2px',
                borderRadius: '8px',
                cursor: 'pointer',
                border: chatMode ? '2px solid #60a5fa' : '1.5px solid #3b82f6',
                background: chatMode
                  ? 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)'
                  : 'linear-gradient(180deg, #1e3a8a 0%, #172554 100%)',
                boxShadow: chatMode
                  ? '0 0 14px rgba(59,130,246,0.6), inset 0 1px 0 rgba(255,255,255,0.3)'
                  : '0 2px 6px rgba(59,130,246,0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
                transition: 'all 0.15s ease',
                outline: 'none',
              }}
            >
              {/* Unread message count badge on MSG button */}
              {unreadMsgCount > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: '-4px',
                    right: '-4px',
                    minWidth: '14px',
                    height: '14px',
                    padding: '0 3px',
                    borderRadius: '7px',
                    background: 'linear-gradient(180deg, #ef4444 0%, #dc2626 100%)',
                    border: '1.5px solid #ffffff',
                    color: '#ffffff',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '7px',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(239, 68, 68, 0.8), 0 0 10px rgba(239, 68, 68, 0.6)',
                    animation: 'pulse 1.5s ease-in-out infinite',
                    zIndex: 10,
                  }}
                >
                  {unreadMsgCount > 99 ? '99+' : unreadMsgCount}
                </div>
              )}

              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '7.5px',
                  letterSpacing: '0.08em',
                  color: '#ffffff',
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                MSG
              </span>
            </button>
          </div>

          {/* ── 4. PREVIOUS FULL-HEIGHT MSG CHAT OVERLAY (SLIDES IN/OUT WITHIN THE APP'S MAIN BODY) ── */}
          <div
            style={{
              position: 'absolute',
              top: '46px',
              bottom: '12px',
              left: '12px',
              right: '12px',
              transform: chatMode ? 'translateX(0)' : 'translateX(100%)',
              transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.25s ease, visibility 0.3s',
              pointerEvents: chatMode ? 'auto' : 'none',
              visibility: chatMode ? 'visible' : 'hidden',
              opacity: chatMode ? 1 : 0,
              boxShadow: chatMode ? '-4px 0 30px rgba(0,0,0,0.9)' : 'none',
              borderRadius: '10px',
              overflow: 'hidden',
              zIndex: 35,
              background: '#0d0d18',
            }}
          >
            <ChatPanel
              isOpen={chatMode}
              peers={peers}
              myProfile={myProfile}
              selectedPeer={selected}
              chats={chats}
              broadcastHistory={broadcastHistory}
              callState={effectiveCallState}
              onSelectPeer={(p) => {
                setSelected(p)
                handleMarkRoomAsRead(p)
              }}
              onSendMessage={handleSendMessage}
              onCallPeer={handleCallSpecificPeer}
              onEndCall={handleEnd}
              onClearRoomChat={handleClearRoomChat}
              onClearBroadcastHistory={handleClearBroadcastHistory}
              onDeleteSingleMessage={handleDeleteSingleMessage}
              onClose={() => setChatMode(false)}
              onOpenBroadcast={() => {
                if (systemSettings.broadcastPermission === 'admin-only' && myProfile.ext !== '100') {
                  sound.playDisconnectTone()
                  setBroadcastAlert('PA BROADCAST RESTRICTED TO EXT 100 ADMIN')
                  setTimeout(() => setBroadcastAlert(null), 4000)
                  return
                }
                setShowBroadcastModal(true)
              }}
            />
          </div>

          {/* ── 5. FOOTER LINE (UNIT PROFILE · EXT & LAN ACTIVE) ── */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '9px',
              padding: '0 2px',
            }}
          >
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '6.5px',
                letterSpacing: '0.1em',
                color: '#555577',
              }}
            >
              {myProfile.full?.toUpperCase() || 'UNIT'} · EXT {myProfile.ext}
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '6.5px',
                letterSpacing: '0.08em',
                color: '#22c55e99',
              }}
            >
              LAN: P2P ACTIVE
            </span>
          </div>

          {/* ── 5. IN-TEMPLATE INTEGRATED GUIDE DRAWER (PLACED AFTER FOOTER) ── */}
          {showGuide ? (
            <div
              style={{
                marginTop: '6px',
                background: 'rgba(10, 10, 20, 0.95)',
                border: '1px solid #333352',
                borderRadius: '8px',
                padding: '5px 8px',
                fontSize: '7.5px',
                color: '#9999c0',
                lineHeight: 1.35,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)',
                animation: 'pulse-dot 0.3s ease-out',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              <div style={{ flex: 1, textAlign: 'center' }}>
                <span>💡 </span>
                <strong style={{ color: '#4ade80' }}>CALL/END</strong>
                <span> · </span>
                <strong style={{ color: '#f59e0b' }}>PAGE</strong>
                <span> (15s Beep) · </span>
                <strong style={{ color: '#60a5fa' }}>MSG</strong>
                <span> (Chat)</span>
              </div>
              <button
                type="button"
                onClick={closeGuide}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#7777aa',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '0 2px',
                  marginLeft: '4px',
                  lineHeight: 1,
                  display: 'flex',
                  alignItems: 'center',
                }}
                title="Hide guide"
              >
                ✕
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '5px' }}>
              <button
                type="button"
                onClick={openGuide}
                style={{
                  background: '#151524',
                  border: '1px solid #282840',
                  borderRadius: '10px',
                  padding: '2px 8px',
                  fontSize: '7px',
                  color: '#7777aa',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  boxShadow: 'inset 0 1px 0 #2e2e48, 0 1px 3px rgba(0,0,0,0.4)',
                  transition: 'all 0.15s ease',
                }}
                title="Tap to show quick guide (auto-hides in 10s)"
              >
                <span style={{ fontSize: '8px' }}>💡</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.06em', fontWeight: 600 }}>
                  GUIDE ▲
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── PiP MODE: RIGHT-EDGE HOVER SLIDE-OUT HANDLE BUTTON (ONLY APPLIES ON MOUSE HOVER) ── */}
      {isPipMode && isPipCollapsed && (
        <div
          id="opap-pip-edge-hotspot"
          onMouseEnter={() => setIsEdgeHovered(true)}
          onMouseLeave={() => setIsEdgeHovered(false)}
          onClick={() => {
            sound.playKeyClick()
            setIsPipCollapsed(false)
            setIsEdgeHovered(false)
          }}
          style={{
            position: 'fixed',
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            width: isEdgeHovered ? '80px' : '20px',
            height: '240px',
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            cursor: 'pointer',
            pointerEvents: 'auto',
            background: 'transparent',
          }}
          title={isEdgeHovered ? 'Click to slide out OPAP Mobile from screen bezel' : undefined}
        >
          {/* Slide-out button (COMPLETELY HIDDEN UNTIL MOUSE HOVERS) */}
          <div
            style={{
              background: 'linear-gradient(135deg, #202038 0%, #10101c 100%)',
              border: '1.5px solid #3b82f6',
              borderRight: 'none',
              borderTopLeftRadius: '12px',
              borderBottomLeftRadius: '12px',
              padding: '14px 8px 14px 10px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '7px',
              boxShadow: '-8px 0 30px rgba(59, 130, 246, 0.7), inset 0 1px 0 rgba(255,255,255,0.25)',
              transform: isEdgeHovered ? 'translateX(0)' : 'translateX(100%)',
              opacity: isEdgeHovered ? 1 : 0,
              visibility: isEdgeHovered ? 'visible' : 'hidden',
              transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease, visibility 0.25s',
              userSelect: 'none',
              pointerEvents: isEdgeHovered ? 'auto' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <span style={{ fontSize: '11px', color: '#60a5fa', animation: 'bounce-x 1.2s infinite' }}>◀</span>
              <span style={{ fontSize: '13px', lineHeight: 1 }}>📟</span>
            </div>
            <span
              style={{
                writingMode: 'vertical-rl',
                textOrientation: 'mixed',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '8.5px',
                fontWeight: 800,
                letterSpacing: '0.14em',
                color: '#93c5fd',
                textShadow: '0 0 8px rgba(147, 197, 253, 0.8)',
                whiteSpace: 'nowrap',
              }}
            >
              OPEN OPAP
            </span>
            <div
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: STATUS_COLOR[myProfile.status] || '#22c55e',
                boxShadow: `0 0 8px ${STATUS_COLOR[myProfile.status] || '#22c55e'}`,
                animation: 'pulse-dot 2s infinite',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  )
}
