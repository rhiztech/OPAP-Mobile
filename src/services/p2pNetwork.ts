import { Peer, Status, Message, BroadcastAnnouncement, CallSignal, P2PPayload, NetworkStats, MessageType } from '../types/opap'
import { sound } from './soundSynthesizer'

const STORAGE_KEY_ME = 'opap_p2p_local_peer'
const memStorage: Record<string, string> = {}

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return memStorage[key] || null
  }
}

function safeSetItem(key: string, val: string) {
  try {
    localStorage.setItem(key, val)
  } catch {
    memStorage[key] = val
  }
}

function isExtMatch(extA?: string | null, extB?: string | null): boolean {
  if (!extA || !extB) return false
  const a = String(extA).trim()
  const b = String(extB).trim()
  if (a === b) return true
  const normA = a.replace(/^10/, '')
  const normB = b.replace(/^10/, '')
  return normA === normB
}

const DEMO_STAFF_TEMPLATES: Omit<Peer, 'lastSeen'>[] = [
  { id: 'sim-1', name: 'Sarah', full: 'Sarah Mitchell', ext: '101', status: 'idle', isSimulated: true },
  { id: 'sim-2', name: 'James', full: 'James Okoro', ext: '102', status: 'busy', isSimulated: true },
  { id: 'sim-3', name: 'Priya', full: 'Priya Nair', ext: '103', status: 'away', isSimulated: true },
  { id: 'sim-4', name: 'Marcus', full: 'Marcus Lee', ext: '104', status: 'idle', isSimulated: true },
  { id: 'sim-5', name: 'Elena', full: 'Elena Voss', ext: '105', status: 'busy', isSimulated: true },
  { id: 'sim-6', name: 'Thomas', full: 'Thomas Ryan', ext: '106', status: 'idle', isSimulated: true },
  { id: 'sim-7', name: 'Yuki', full: 'Yuki Tanaka', ext: '107', status: 'away', isSimulated: true },
  { id: 'sim-8', name: 'David', full: 'David Ade', ext: '108', status: 'idle', isSimulated: true },
  { id: 'sim-9', name: 'Anna', full: 'Anna Cruz', ext: '109', status: 'busy', isSimulated: true },
]

export class P2PNetworkService {
  private me: Peer
  private peers: Map<string, Peer> = new Map()
  private channel: BroadcastChannel | null = null
  private eventSource: EventSource | null = null
  private heartbeatTimer: number | null = null
  private cleanupTimer: number | null = null
  private simulatedPeersEnabled: boolean = false

  // Stats
  private packetsSent: number = 0
  private packetsReceived: number = 0
  private lastLatency: number = 1

  // Callbacks
  private onPeersUpdatedCbs: Set<(peers: Peer[]) => void> = new Set()
  private onChatMessageCbs: Set<(msg: Message) => void> = new Set()
  private onMessageAckCbs: Set<(ack: { messageId: string; status: 'delivered' | 'read' }) => void> = new Set()
  private onMessageDeleteCbs: Set<(data: { messageId: string; deletedBy: string; targetPeerId?: string }) => void> = new Set()
  private onBroadcastCbs: Set<(b: BroadcastAnnouncement) => void> = new Set()
  private onCallSignalCbs: Set<(s: CallSignal) => void> = new Set()
  private onSystemSettingsCbs: Set<(settings: SystemSettings) => void> = new Set()
  private onStatsUpdatedCbs: Set<(stats: NetworkStats) => void> = new Set()
  private onProfileUpdatedCbs: Set<(me: Peer) => void> = new Set()

  constructor() {
    this.me = this.loadOrCreateLocalProfile()
    this.initTransport()
    if (this.simulatedPeersEnabled) {
      this.initSimulatedPeers()
    }
    this.startHeartbeat()
  }

  public isRegistered(): boolean {
    try {
      if (typeof localStorage === 'undefined') return true
      const isReg = localStorage.getItem('opap_registered') === 'true'
      const savedName = (localStorage.getItem('opap_user_name') || '').trim()
      const profileName = (this.me?.name || '').trim()
      const effectiveName = savedName || profileName

      if (!isReg) return false
      if (!effectiveName || effectiveName.length < 1) return false
      if (effectiveName === 'Reception' && !localStorage.getItem('opap_user_name')) return false

      return true
    } catch {
      return false
    }
  }

  private loadOrCreateLocalProfile(): Peer {
    // 1. Try sessionStorage first for clean per-tab isolation
    try {
      if (typeof sessionStorage !== 'undefined') {
        const sessionSaved = sessionStorage.getItem('opap_p2p_session_peer')
        if (sessionSaved) {
          const parsed = JSON.parse(sessionSaved)
          return {
            ...parsed,
            lastSeen: Date.now(),
            isLocal: true,
          }
        }
      }
    } catch {}

    // 2. Try localStorage fallback
    try {
      const saved = safeGetItem(STORAGE_KEY_ME)
      const savedName = (safeGetItem('opap_user_name') || '').trim()
      const savedExt = (safeGetItem('opap_station_ext') || '').trim()
      const savedFull = (safeGetItem('opap_station_full') || '').trim()

      if (saved) {
        const parsed = JSON.parse(saved)
        const isDefaultColliding = parsed.name === 'Reception' && parsed.ext !== '100'
        const freshId = `peer-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`
        const finalName = savedName || parsed.name || ''
        const finalExt = savedExt || (isDefaultColliding ? '100' : (parsed.ext || '101'))
        const profile: Peer = {
          ...parsed,
          name: finalName,
          full: savedFull || parsed.full || (finalName ? `${finalName} Unit` : ''),
          id: freshId, // Unique ID per tab instance
          ext: finalExt,
          lastSeen: Date.now(),
          isLocal: true,
        }
        this.saveLocalProfile(profile)
        return profile
      }
    } catch {}

    const freshId = `peer-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`
    const initialName = (safeGetItem('opap_user_name') || '').trim()
    const initialExt = (safeGetItem('opap_station_ext') || '101').trim()
    const initial: Peer = {
      id: freshId,
      name: initialName,
      full: safeGetItem('opap_station_full') || (initialName ? `${initialName} Unit` : ''),
      ext: initialExt,
      status: 'idle',
      isLocal: true,
      lastSeen: Date.now(),
    }
    this.saveLocalProfile(initial)
    return initial
  }

  private saveLocalProfile(p: Peer) {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('opap_p2p_session_peer', JSON.stringify(p))
      }
      safeSetItem(STORAGE_KEY_ME, JSON.stringify(p))
      if (p.name && p.name.trim().length >= 2) {
        safeSetItem('opap_user_name', p.name.trim())
      }
      if (p.ext) {
        safeSetItem('opap_station_ext', p.ext.trim())
      }
      if (p.full) {
        safeSetItem('opap_station_full', p.full.trim())
      }
    } catch {}
  }

  private initTransport() {
    // 1. BroadcastChannel for same-browser tabs
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        this.channel = new BroadcastChannel('opap_p2p_lan_mesh_v1')
        this.channel.onmessage = (event: MessageEvent<P2PPayload>) => {
          this.handleIncomingPayload(event.data)
        }
      }
    } catch (e) {
      console.warn('BroadcastChannel fallback', e)
    }

    // 2. Real LAN SSE Stream for cross-browser & cross-device mesh
    if (typeof window !== 'undefined' && typeof window.EventSource !== 'undefined') {
      try {
        this.eventSource = new EventSource('/api/p2p/events')
        this.eventSource.onmessage = (event) => {
          try {
            const raw = event.data ? event.data.trim() : ''
            if (raw.startsWith('{')) {
              const payload = JSON.parse(raw) as P2PPayload
              this.handleIncomingPayload(payload)
            }
          } catch {}
        }
        this.eventSource.onerror = () => {}
      } catch (e) {
        console.warn('LAN SSE fallback', e)
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === 'opap_p2p_bus_event' && e.newValue) {
          try {
            const payload = JSON.parse(e.newValue) as P2PPayload
            this.handleIncomingPayload(payload)
          } catch {}
        }
      })

      window.addEventListener('beforeunload', () => {
        this.broadcastPayload({
          type: 'peer-leave',
          sender: this.me,
          timestamp: Date.now(),
        })
      })
    }
  }

  private initSimulatedPeers() {
    DEMO_STAFF_TEMPLATES.forEach((tpl) => {
      if (tpl.ext !== this.me.ext) {
        this.peers.set(tpl.id, {
          ...tpl,
          lastSeen: Date.now(),
        })
      }
    })
  }

  private startHeartbeat() {
    // Avoid anonymous presence: do not announce until user details have been configured
    if (this.isRegistered()) {
      this.broadcastPayload({
        type: 'peer-announce',
        sender: this.me,
        timestamp: Date.now(),
      })
    }

    if (typeof window !== 'undefined') {
      // 1. Probe any previously saved peer IPs from localStorage on startup
      try {
        const raw = localStorage.getItem('opap_known_peer_ips')
        if (raw) {
          const list = JSON.parse(raw)
          if (Array.isArray(list)) {
            list.forEach((ip: string) => {
              if (ip && typeof ip === 'string') {
                this.addManualPeer(ip).catch(() => {})
              }
            })
          }
        }
      } catch {}

      // 2. Regular heartbeat broadcast every 2s (only when registered)
      this.heartbeatTimer = window.setInterval(() => {
        if (!this.isRegistered()) return
        this.broadcastPayload({
          type: 'peer-heartbeat',
          sender: this.me,
          timestamp: Date.now(),
        })
      }, 2000)

      // 3. Sync with local backend discovery every 5s
      window.setInterval(async () => {
        if (!this.isRegistered()) return
        try {
          const peers = await this.getNetworkPeerNodes()
          for (const p of peers) {
            if (p.ip) {
              // Direct HTTP handshake to sync station details
              const targetUrl = `http://${p.ip}:${p.port || 8443}/api/p2p/peer-register`
              fetch(targetUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  station: this.me,
                  senderIp: window.location.hostname && window.location.hostname !== 'localhost' ? window.location.hostname : undefined,
                  port: 8443,
                }),
              })
                .then((r) => r.json())
                .then((data) => {
                  if (data && data.station) {
                    this.handleIncomingPayload({
                      type: 'peer-announce',
                      sender: data.station,
                      timestamp: Date.now(),
                    })
                  }
                })
                .catch(() => {})
            }
          }
        } catch {}
      }, 5000)

      this.cleanupTimer = window.setInterval(() => {
        const now = Date.now()
        let changed = false
        this.peers.forEach((peer, id) => {
          if (!peer.isSimulated && now - peer.lastSeen > 12000) {
            this.peers.delete(id)
            changed = true
          }
        })
        if (changed) {
          this.notifyPeersUpdated()
        }
      }, 3000)
    }
  }

  private broadcastPayload(payload: P2PPayload) {
    this.packetsSent++

    // 1. BroadcastChannel (Same-browser)
    try {
      if (this.channel) {
        this.channel.postMessage(payload)
      } else {
        safeSetItem('opap_p2p_bus_event', JSON.stringify({ ...payload, _rnd: Math.random() }))
      }
    } catch {}

    // 2. HTTP LAN Signaling Bus (Cross-browser, Cross-device, Wi-Fi)
    if (typeof fetch !== 'undefined') {
      fetch('/api/p2p/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {})
    }

    this.notifyStats()
  }

  private handleIncomingPayload(payload: P2PPayload) {
    if (!payload) return

    // Special event from Electron UDP/TCP discovery: new LAN peer PC was found
    if ((payload as any).type === 'lan-peer-discovered') {
      const peerIp = (payload as any).peerIp
      const port = (payload as any).port || 8443
      if (peerIp && typeof fetch !== 'undefined') {
        fetch(`http://${peerIp}:${port}/api/p2p/peer-register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            station: this.me,
            senderIp: window.location.hostname && window.location.hostname !== 'localhost' ? window.location.hostname : undefined,
            port: 8443,
          }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data && data.station) {
              this.handleIncomingPayload({
                type: 'peer-announce',
                sender: data.station,
                timestamp: Date.now(),
              })
            }
          })
          .catch(() => {})
      }
      this.broadcastPayload({
        type: 'peer-announce',
        sender: this.me,
        timestamp: Date.now(),
      })
      return
    }

    // Remote station is requesting we announce ourselves (bidirectional discovery handshake)
    if ((payload as any).type === 'peer-request-announce') {
      this.broadcastPayload({
        type: 'peer-announce',
        sender: this.me,
        timestamp: Date.now(),
      })
      return
    }

    if (!payload.sender) return
    // Ignore only if exact same instance and extension
    if (payload.sender.id === this.me.id && String(payload.sender.ext) === String(this.me.ext)) return

    this.packetsReceived++
    this.lastLatency = Math.max(1, Date.now() - payload.timestamp)

    switch (payload.type) {
      case 'peer-announce':
      case 'peer-heartbeat': {
        // Automatic extension conflict resolution:
        // If another distinct PC claims the same extension:
        if (payload.sender.id !== this.me.id && String(payload.sender.ext).trim() === String(this.me.ext).trim()) {
          // The station with higher ID or default Reception yields to existing station
          if (this.me.id > payload.sender.id || this.me.name === 'Reception') {
            const occupied = new Set<string>()
            occupied.add(String(payload.sender.ext).trim())
            this.peers.forEach((p) => occupied.add(String(p.ext).trim()))
            const candidateExts = ['101', '102', '103', '104', '105', '106', '107', '108', '109']
            const freeExt = candidateExts.find((e) => !occupied.has(e)) || '101'

            this.me = {
              ...this.me,
              ext: freeExt,
              name: this.me.name === 'Reception' ? `Unit ${freeExt}` : this.me.name,
              full: this.me.name === 'Reception' ? `Unit ${freeExt} (Auto)` : `${this.me.name} Unit`,
              lastSeen: Date.now(),
            }
            this.saveLocalProfile(this.me)
            safeSetItem(STORAGE_KEY_ME, JSON.stringify(this.me))
            this.onProfileUpdatedCbs.forEach((cb) => cb(this.me))

            setTimeout(() => {
              this.broadcastPayload({
                type: 'peer-announce',
                sender: this.me,
                timestamp: Date.now(),
              })
            }, 200)
          }
        }

        const existing = this.peers.get(payload.sender.id)
        const updated: Peer = {
          ...payload.sender,
          lastSeen: Date.now(),
          isSimulated: false,
        }
        this.peers.set(payload.sender.id, updated)

        // If newly discovered peer, respond with our own heartbeat so discovery is immediate in both directions
        if (!existing) {
          setTimeout(() => {
            this.broadcastPayload({
              type: 'peer-heartbeat',
              sender: this.me,
              timestamp: Date.now(),
            })
          }, 150)
        }
        this.notifyPeersUpdated()
        break
      }

      case 'peer-leave': {
        if (this.peers.has(payload.sender.id)) {
          this.peers.delete(payload.sender.id)
          this.notifyPeersUpdated()
        }
        break
      }

      case 'chat-message': {
        if (payload.message) {
          const msg = payload.message
          // Target matches if my extension matches msg.targetExt/recipientExt, or my ID matches msg.targetId/recipientId
          const targetExtVal = String(msg.targetExt || msg.recipientExt || '').trim()

          const isTargetedToMe =
            isExtMatch(targetExtVal, this.me.ext) ||
            msg.targetId === this.me.id ||
            msg.recipientId === this.me.id ||
            payload.targetPeerId === this.me.id ||
            isExtMatch(payload.targetPeerId, this.me.ext)

          const isFromMyself =
            msg.senderId === this.me.id && isExtMatch(msg.senderExt, this.me.ext)

          if (isTargetedToMe && !isFromMyself) {
            sound.playPagerChirp()
            const receivedMsg: Message = {
              ...msg,
              timestamp: msg.timestamp || payload.timestamp || Date.now(),
              from: 'them',
              status: 'delivered',
            }
            this.onChatMessageCbs.forEach((cb) => cb(receivedMsg))

            this.broadcastPayload({
              type: 'message-ack',
              sender: this.me,
              targetPeerId: msg.senderId,
              data: {
                messageId: msg.id,
                status: 'delivered',
              },
              timestamp: Date.now(),
            })
          }
        }
        break
      }

      case 'message-ack': {
        const ackData = (payload.data || payload) as { messageId?: string; status?: 'delivered' | 'read' }
        if (payload.targetPeerId === this.me.id && ackData.messageId && ackData.status) {
          this.onMessageAckCbs.forEach((cb) => cb({ messageId: ackData.messageId!, status: ackData.status! }))
        }
        break
      }

      case 'message-delete': {
        const data = (payload.data || payload) as { messageId?: string; deletedBy?: string }
        if (data.messageId) {
          this.onMessageDeleteCbs.forEach((cb) =>
            cb({
              messageId: data.messageId!,
              deletedBy: data.deletedBy || payload.sender.id,
              targetPeerId: payload.targetPeerId,
            })
          )
        }
        break
      }

      case 'broadcast-page': {
        if (payload.announcement) {
          sound.playBroadcastChime()
          this.onBroadcastCbs.forEach((cb) => cb(payload.announcement!))
        }
        break
      }

      case 'call-signal': {
        if (payload.signal) {
          const sig = payload.signal
          // Target matches by unique Peer ID or Extension Number (with 101/1 format tolerance)
          const isTargetedToMe =
            sig.targetExt === '*' ||
            sig.targetId === '*' ||
            isExtMatch(sig.targetExt, this.me.ext) ||
            sig.targetId === this.me.id ||
            payload.targetPeerId === this.me.id ||
            isExtMatch(payload.targetPeerId, this.me.ext)

          const isFromMyself =
            sig.callerId === this.me.id && isExtMatch(sig.callerExt, this.me.ext)

          console.log(`[P2P] call-signal received: type=${sig.type}, targetExt=${sig.targetExt}, myExt=${this.me.ext}, targetId=${sig.targetId}, myId=${this.me.id}, isTargetedToMe=${isTargetedToMe}, isFromMyself=${isFromMyself}`)

          if (isTargetedToMe && !isFromMyself) {
            console.log(`[P2P] ✅ Delivering signal type=${sig.type} to voiceCall handler`)
            this.onCallSignalCbs.forEach((cb) => cb(sig))
          } else {
            console.log(`[P2P] ❌ Dropping signal type=${sig.type} (targeted=${isTargetedToMe}, self=${isFromMyself})`)
          }
        }
        break
      }

      case 'system-config-sync': {
        if (payload.systemSettings) {
          this.onSystemSettingsCbs.forEach((cb) => cb(payload.systemSettings!))
        }
        break
      }
    }

    this.notifyStats()
  }

  public getMyProfile(): Peer {
    return { ...this.me }
  }

  public updateMyProfile(updates: Partial<Pick<Peer, 'name' | 'full' | 'ext' | 'status'>>) {
    this.me = {
      ...this.me,
      ...updates,
      lastSeen: Date.now(),
    }
    this.saveLocalProfile(this.me)
    if (this.me.name && this.me.name.trim().length >= 1) {
      safeSetItem('opap_registered', 'true')
    }

    // Direct Electron station profile sync if running inside desktop host
    try {
      if (typeof window !== 'undefined' && (window as any).opapDesktop?.saveStationProfile) {
        (window as any).opapDesktop.saveStationProfile(this.me)
      }
    } catch {}

    if (this.simulatedPeersEnabled) {
      DEMO_STAFF_TEMPLATES.forEach((tpl) => {
        if (tpl.ext === this.me.ext) {
          this.peers.delete(tpl.id)
        } else if (!this.peers.has(tpl.id)) {
          this.peers.set(tpl.id, {
            ...tpl,
            lastSeen: Date.now(),
          })
        }
      })
    }

    if (this.isRegistered()) {
      this.broadcastPayload({
        type: 'peer-announce',
        sender: this.me,
        timestamp: Date.now(),
      })
    }

    this.notifyPeersUpdated()
  }

  public getPeers(): Peer[] {
    return Array.from(this.peers.values())
  }

  public getDiscoveredPeers(): Peer[] {
    return Array.from(this.peers.values())
  }

  public sendChatMessage(
    targetId: string,
    targetExt: string,
    text: string,
    msgType: MessageType = 'text',
    audioData?: string
  ): Message {
    if (!this.isRegistered()) {
      console.warn('[P2P] Blocked sendChatMessage: Station registration required before messaging')
      return null as any
    }
    const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    const now = Date.now()
    const msg: Message = {
      id: `msg-${now}-${Math.random().toString(36).substr(2, 6)}`,
      from: 'me',
      senderId: this.me.id,
      senderName: this.me.name,
      senderExt: this.me.ext,
      recipientId: targetId,
      recipientExt: targetExt,
      targetId,
      targetExt,
      text,
      time: timeStr,
      timestamp: now,
      status: 'sent',
      type: msgType,
      audioData,
    }

    this.broadcastPayload({
      type: 'chat-message',
      sender: this.me,
      targetPeerId: targetId,
      message: msg,
      timestamp: now,
    })

    return msg
  }

  public sendBroadcastPage(text: string): BroadcastAnnouncement {
    if (!this.isRegistered()) {
      console.warn('[P2P] Blocked sendBroadcastPage: Station registration required before broadcasting')
      return null as any
    }
    const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    const announcement: BroadcastAnnouncement = {
      id: `page-${Date.now()}`,
      senderId: this.me.id,
      senderName: this.me.name,
      senderExt: this.me.ext,
      text,
      time: timeStr,
    }

    this.broadcastPayload({
      type: 'broadcast-page',
      sender: this.me,
      announcement,
      timestamp: Date.now(),
    })

    sound.playBroadcastChime()
    return announcement
  }

  public sendCallSignal(signal: CallSignal) {
    if (!this.isRegistered()) {
      console.warn('[P2P] Blocked sendCallSignal: Station registration required before placing calls')
      return
    }
    this.broadcastPayload({
      type: 'call-signal',
      sender: this.me,
      targetPeerId: signal.targetId,
      signal,
      timestamp: Date.now(),
    })
  }

  public toggleSimulatedPeers(enabled: boolean) {
    this.simulatedPeersEnabled = enabled
    if (!enabled) {
      this.peers.forEach((p, id) => {
        if (p.isSimulated) this.peers.delete(id)
      })
    } else {
      this.initSimulatedPeers()
    }
    this.notifyPeersUpdated()
  }

  public isSimulatedPeersEnabled(): boolean {
    return this.simulatedPeersEnabled
  }

  public getNetworkStats(): NetworkStats {
    let activePeers = 0
    let lanPeers = 0
    let simPeers = 0

    this.peers.forEach((p) => {
      activePeers++
      if (p.isSimulated) simPeers++
      else lanPeers++
    })

    return {
      peerCount: activePeers,
      lanPeerCount: lanPeers,
      simulatedPeerCount: simPeers,
      packetsSent: this.packetsSent,
      packetsReceived: this.packetsReceived,
      latencyMs: this.lastLatency,
      channelName: 'opap_p2p_lan_mesh_v1',
      myIp: window.location.hostname || 'localhost',
    }
  }

  private notifyPeersUpdated() {
    const list = this.getDiscoveredPeers()
    this.onPeersUpdatedCbs.forEach((cb) => cb(list))
    this.notifyStats()
  }

  private notifyStats() {
    const stats = this.getNetworkStats()
    this.onStatsUpdatedCbs.forEach((cb) => cb(stats))
  }

  public onPeersUpdated(cb: (peers: Peer[]) => void): () => void {
    this.onPeersUpdatedCbs.add(cb)
    cb(this.getDiscoveredPeers())
    return () => this.onPeersUpdatedCbs.delete(cb)
  }

  public onChatMessage(cb: (msg: Message) => void): () => void {
    this.onChatMessageCbs.add(cb)
    return () => this.onChatMessageCbs.delete(cb)
  }

  public onMessageAck(cb: (ack: { messageId: string; status: 'delivered' | 'read' }) => void): () => void {
    this.onMessageAckCbs.add(cb)
    return () => this.onMessageAckCbs.delete(cb)
  }

  public sendDeleteMessage(messageId: string, targetPeerId?: string) {
    this.broadcastPayload({
      type: 'message-delete',
      sender: this.me,
      targetPeerId,
      data: {
        messageId,
        deletedBy: this.me.id,
      },
      timestamp: Date.now(),
    })
  }

  public onMessageDelete(
    cb: (data: { messageId: string; deletedBy: string; targetPeerId?: string }) => void
  ): () => void {
    this.onMessageDeleteCbs.add(cb)
    return () => this.onMessageDeleteCbs.delete(cb)
  }

  public onBroadcast(cb: (b: BroadcastAnnouncement) => void): () => void {
    this.onBroadcastCbs.add(cb)
    return () => this.onBroadcastCbs.delete(cb)
  }

  public onCallSignal(cb: (s: CallSignal) => void): () => void {
    this.onCallSignalCbs.add(cb)
    return () => this.onCallSignalCbs.delete(cb)
  }

  public broadcastSystemSettings(settings: SystemSettings) {
    this.broadcastPayload({
      type: 'system-config-sync',
      sender: this.me,
      systemSettings: settings,
      timestamp: Date.now(),
    })
  }

  public onSystemSettings(cb: (settings: SystemSettings) => void): () => void {
    this.onSystemSettingsCbs.add(cb)
    return () => this.onSystemSettingsCbs.delete(cb)
  }

  public onStatsUpdated(cb: (stats: NetworkStats) => void): () => void {
    this.onStatsUpdatedCbs.add(cb)
    return () => this.onStatsUpdatedCbs.delete(cb)
  }

  public onProfileUpdated(cb: (me: Peer) => void): () => void {
    this.onProfileUpdatedCbs.add(cb)
    return () => this.onProfileUpdatedCbs.delete(cb)
  }

  public async addManualPeer(ip: string, port: number = 8443): Promise<boolean> {
    const cleanIp = ip.trim()
    if (!cleanIp) return false

    // Save to persistent localStorage known IPs
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem('opap_known_peer_ips') || '[]'
        const list = JSON.parse(raw)
        if (!list.includes(cleanIp)) {
          list.push(cleanIp)
          localStorage.setItem('opap_known_peer_ips', JSON.stringify(list))
        }
      }
    } catch {}

    // 1. Notify local backend
    try {
      if (typeof fetch !== 'undefined') {
        await fetch('/api/p2p/add-peer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip: cleanIp, port }),
        })
      }
    } catch {}
    if (typeof window !== 'undefined' && (window as any).opapDesktop?.addPeer) {
      try {
        await (window as any).opapDesktop.addPeer(cleanIp, port)
      } catch {}
    }

    // 2. Direct HTTP handshake to remote station
    try {
      if (typeof fetch !== 'undefined') {
        fetch(`http://${cleanIp}:${port}/api/p2p/peer-register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            station: this.me,
            senderIp: window.location.hostname && window.location.hostname !== 'localhost' ? window.location.hostname : undefined,
            port: 8443,
          }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data && data.station) {
              this.handleIncomingPayload({
                type: 'peer-announce',
                sender: data.station,
                timestamp: Date.now(),
              })
            }
          })
          .catch(() => {})

        // Probe status directly
        fetch(`http://${cleanIp}:${port}/api/status`)
          .then((r) => r.json())
          .then((status) => {
            if (status && status.station) {
              this.handleIncomingPayload({
                type: 'peer-announce',
                sender: status.station,
                timestamp: Date.now(),
              })
            }
          })
          .catch(() => {})
      }
    } catch {}

    // 3. Broadcast announce locally and across mesh
    this.broadcastPayload({
      type: 'peer-announce',
      sender: this.me,
      timestamp: Date.now(),
    })
    return true
  }

  public async getNetworkPeerNodes(): Promise<Array<{ ip: string; port: number; lastSeen: number; isManual?: boolean }>> {
    if (typeof window !== 'undefined' && (window as any).opapDesktop?.getPeers) {
      try {
        const list = await (window as any).opapDesktop.getPeers()
        if (Array.isArray(list)) return list
      } catch {}
    }
    try {
      if (typeof fetch !== 'undefined') {
        const res = await fetch('/api/p2p/peers')
        const data = await res.json()
        if (Array.isArray(data.peers)) return data.peers
      }
    } catch {}
    return []
  }

  public async triggerSubnetScan(): Promise<string[]> {
    if (typeof window !== 'undefined' && (window as any).opapDesktop?.scanNetworkSubnet) {
      try {
        const res = await (window as any).opapDesktop.scanNetworkSubnet()
        if (res && res.peers) {
          this.broadcastPayload({
            type: 'peer-announce',
            sender: this.me,
            timestamp: Date.now(),
          })
          return res.peers
        }
      } catch {}
    }
    try {
      if (typeof fetch !== 'undefined') {
        const res = await fetch('/api/p2p/scan-subnet')
        const data = await res.json()
        if (data && data.peers) {
          this.broadcastPayload({
            type: 'peer-announce',
            sender: this.me,
            timestamp: Date.now(),
          })
          return data.peers
        }
      }
    } catch {}
    return []
  }

  public async getStationNetworkInfo(): Promise<{
    lanIp: string
    port: number
    interfaces: Array<{ name: string; address: string; netmask: string; broadcast: string; subnetPrefix: string | null }>
    discoveredPeers: Array<{ ip: string; port: number; lastSeen: number; isManual?: boolean }>
  } | null> {
    if (typeof window !== 'undefined' && (window as any).opapDesktop?.getStationNetworkInfo) {
      try {
        return await (window as any).opapDesktop.getStationNetworkInfo()
      } catch {}
    }
    try {
      if (typeof fetch !== 'undefined') {
        const res = await fetch('/api/p2p/network-info')
        return await res.json()
      }
    } catch {}
    return null
  }

  public async authorizeFirewall(): Promise<{ ok: boolean; error?: string }> {
    if (typeof window !== 'undefined' && (window as any).opapDesktop?.authorizeFirewall) {
      try {
        return await (window as any).opapDesktop.authorizeFirewall()
      } catch (err: any) {
        return { ok: false, error: err.message }
      }
    }
    return { ok: false, error: 'Not running in standalone desktop app' }
  }

  public async getNetworkProfile(): Promise<string> {
    // Try IPC first (Electron)
    if (typeof window !== 'undefined' && (window as any).opapDesktop?.getNetworkProfile) {
      try {
        return await (window as any).opapDesktop.getNetworkProfile()
      } catch {}
    }
    // Fall back to HTTP API
    try {
      const res = await fetch('/api/network-profile')
      const data = await res.json()
      return data.profile || 'Unknown'
    } catch {}
    return 'Unknown'
  }

  public async fixNetworkProfile(): Promise<{ ok: boolean; before?: string; after?: string; error?: string }> {
    // Try IPC first (Electron)
    if (typeof window !== 'undefined' && (window as any).opapDesktop?.fixNetworkProfile) {
      try {
        return await (window as any).opapDesktop.fixNetworkProfile()
      } catch (err: any) {
        return { ok: false, error: err.message }
      }
    }
    // Fall back to HTTP API
    try {
      const res = await fetch('/api/fix-network-profile', { method: 'POST' })
      return await res.json()
    } catch (err: any) {
      return { ok: false, error: err?.message }
    }
  }
}

export const p2pNetwork = new P2PNetworkService()
