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

  constructor() {
    this.me = this.loadOrCreateLocalProfile()
    this.initTransport()
    if (this.simulatedPeersEnabled) {
      this.initSimulatedPeers()
    }
    this.startHeartbeat()
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
      if (saved) {
        const parsed = JSON.parse(saved)
        const isDefaultColliding = parsed.name === 'Reception' && parsed.ext !== '100'
        const freshId = `peer-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`
        const profile: Peer = {
          ...parsed,
          id: freshId, // Unique ID per tab instance
          ext: isDefaultColliding ? '100' : (parsed.ext || '100'),
          lastSeen: Date.now(),
          isLocal: true,
        }
        this.saveLocalProfile(profile)
        return profile
      }
    } catch {}

    const freshId = `peer-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`
    const initial: Peer = {
      id: freshId,
      name: 'Reception',
      full: 'Reception Unit',
      ext: '100',
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
    this.broadcastPayload({
      type: 'peer-announce',
      sender: this.me,
      timestamp: Date.now(),
    })

    if (typeof window !== 'undefined') {
      this.heartbeatTimer = window.setInterval(() => {
        this.broadcastPayload({
          type: 'peer-heartbeat',
          sender: this.me,
          timestamp: Date.now(),
        })
      }, 2000)

      this.cleanupTimer = window.setInterval(() => {
        const now = Date.now()
        let changed = false
        this.peers.forEach((peer, id) => {
          if (!peer.isSimulated && now - peer.lastSeen > 8000) {
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
    if (!payload || !payload.sender) return
    // Ignore only if exact same instance and extension
    if (payload.sender.id === this.me.id && String(payload.sender.ext) === String(this.me.ext)) return

    this.packetsReceived++
    this.lastLatency = Math.max(1, Date.now() - payload.timestamp)

    switch (payload.type) {
      case 'peer-announce':
      case 'peer-heartbeat': {
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

    this.broadcastPayload({
      type: 'peer-announce',
      sender: this.me,
      timestamp: Date.now(),
    })

    this.notifyPeersUpdated()
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
}

export const p2pNetwork = new P2PNetworkService()
