export type Status = 'idle' | 'busy' | 'away' | 'dnd'
export type CallState = 'idle' | 'calling' | 'ringing' | 'active' | 'ended' | 'paging' | 'receiving-page'
export type ViewMode = 'hidden' | 'pip' | 'full'

export interface Peer {
  id: string
  name: string
  full: string
  ext: string
  status: Status
  isLocal?: boolean
  lastSeen: number
  ip?: string
  avatar?: string
  isSimulated?: boolean
}

export type MessageType = 'text' | 'voice' | 'file' | 'broadcast' | 'call-log'

export interface Message {
  id: string
  senderId: string
  senderName: string
  senderExt: string
  recipientId: string // 'all' for broadcast
  recipientExt?: string
  targetId?: string
  targetExt?: string
  text: string
  time: string
  timestamp: number
  from: 'me' | 'them'
  status: 'sending' | 'sent' | 'delivered' | 'read'
  type?: MessageType
  callType?: 'outgoing' | 'incoming' | 'missed' | 'declined' | 'page'
  callDuration?: number
  audioData?: string // data URL for voice notes
  fileName?: string
  fileData?: string
  isDeleted?: boolean
  deletedBy?: string
  deletedAt?: number
}

export interface BroadcastAnnouncement {
  id: string
  senderName: string
  senderExt: string
  text: string
  time: string
  timestamp: number
}

export interface CallSignal {
  type:
    | 'call-request'
    | 'call-accept'
    | 'call-reject'
    | 'call-end'
    | 'call-hold'
    | 'call-resume'
    | 'call-conference'
    | 'offer'
    | 'answer'
    | 'ice-candidate'
    | 'ptt-start'
    | 'ptt-stop'
    | 'page-alert'
    | 'page-accept'
    | 'page-decline'
    | 'page-cancel'
  callId: string
  callerId: string
  callerName: string
  callerExt: string
  targetId: string
  targetExt: string
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
  timestamp: number
  callRingDuration?: number
  pageToneDuration?: number | 'continuous'
  note?: string
  isConference?: boolean
  conferencePeers?: Peer[]
}

export type CallSessionState = 'active' | 'held' | 'calling' | 'ringing'

export interface CallSession {
  callId: string
  peer: Peer
  state: CallSessionState
  startTime: number
  isInitiator: boolean
  isConference?: boolean
  peerConnection?: RTCPeerConnection | null
  remoteStream?: MediaStream | null
  audioElement?: HTMLAudioElement | null
}

export interface SystemSettings {
  callRingDuration: 15 | 30 | 45 | 60 // seconds
  pageToneDuration: 15 | 30 | 45 | 'continuous' // seconds or continuous
  systemName: string
  broadcastPermission: 'all' | 'admin-only'
  masterPin: string // default '1234'
  lastUpdatedBy?: string
  lastUpdatedAt?: number
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  callRingDuration: 30,
  pageToneDuration: 15,
  systemName: 'OPAP MOBILE INTERCOM',
  broadcastPermission: 'all',
  masterPin: '1234',
}

export interface P2PPayload {
  type:
    | 'heartbeat'
    | 'status-update'
    | 'chat-message'
    | 'message-ack'
    | 'message-delete'
    | 'broadcast-page'
    | 'call-signal'
    | 'peer-leave'
    | 'peer-announce'
    | 'peer-heartbeat'
    | 'system-config-sync'
  sender: Peer
  data?: unknown
  message?: Message
  announcement?: BroadcastAnnouncement
  signal?: CallSignal
  systemSettings?: SystemSettings
  targetPeerId?: string
  timestamp: number
}

export interface NetworkStats {
  peerCount: number
  lanPeerCount?: number
  simulatedPeerCount?: number
  activeTransport?: 'broadcast-channel' | 'webrtc-mesh' | 'hybrid'
  channelName?: string
  myIp?: string
  latencyMs: number
  packetsSent: number
  packetsReceived: number
}
