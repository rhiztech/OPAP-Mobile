import { Peer, CallState, CallSignal, CallSession } from '../types/opap'
import { p2pNetwork } from './p2pNetwork'
import { sound } from './soundSynthesizer'

export class VoiceCallManager {
  private callState: CallState = 'idle'
  private currentPeer: Peer | null = null
  private currentCallId: string | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  private peerConnection: RTCPeerConnection | null = null
  private audioElement: HTMLAudioElement | null = null
  private isMuted: boolean = false
  private isPttActive: boolean = false
  private pageTimeoutTimer: number | null = null
  private callTimeoutTimer: number | null = null
  private callTimeoutTimers: Map<string, number> = new Map()
  private callRingDurationMs: number = 30000
  private pageToneDurationSec: number | 'continuous' = 15
  private volumeLevel: number = 0.8
  private pendingCandidates: RTCIceCandidateInit[] = []

  // GSM Multi-Call & Conference Session Engine
  private sessions: Map<string, CallSession> = new Map()
  private activeCallId: string | null = null
  private heldCallId: string | null = null
  private isConference: boolean = false
  private isHeldByRemote: boolean = false
  private waitingCall: { signal: CallSignal; caller: Peer } | null = null

  // Multi-Call WebRTC and Audio Elements Map
  private connections: Map<string, RTCPeerConnection> = new Map()
  private remoteStreams: Map<string, MediaStream> = new Map()
  private audioElements: Map<string, HTMLAudioElement> = new Map()
  private pendingCandidatesMap: Map<string, RTCIceCandidateInit[]> = new Map()

  // Audio Analyser for LCD VU Meter & Audio Routing
  private audioCtx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  private remoteSource: MediaStreamAudioSourceNode | null = null
  private remoteGainNode: GainNode | null = null
  private audioLevel: number = 0
  private audioAnimFrame: number | null = null

  // Callbacks
  private onStateChangeCbs: Set<(state: CallState, peer: Peer | null) => void> = new Set()
  private onIncomingCallCbs: Set<(signal: CallSignal, caller: Peer) => void> = new Set()
  private onIncomingPageCbs: Set<(signal: CallSignal, caller: Peer) => void> = new Set()
  private onPageTimeoutCbs: Set<(peer: Peer, isInitiator: boolean) => void> = new Set()
  private onPageResponseCbs: Set<(peer: Peer, type: 'accepted' | 'declined', note?: string) => void> = new Set()
  private onAudioLevelCbs: Set<(level: number) => void> = new Set()
  private onCallWaitingCbs: Set<(signal: CallSignal, caller: Peer) => void> = new Set()
  private onMultiCallChangeCbs: Set<(info: {
    activePeer: Peer | null
    heldPeer: Peer | null
    isConference: boolean
    isHeldByRemote: boolean
    sessions: CallSession[]
    waitingCall: { signal: CallSignal; caller: Peer } | null
  }) => void> = new Set()

  private rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.services.mozilla.com' },
    ],
    iceCandidatePoolSize: 10,
  }

  constructor() {
    try {
      if (typeof document !== 'undefined') {
        let el = document.getElementById('opap-remote-voice-audio') as HTMLAudioElement | null
        if (!el) {
          el = document.createElement('audio')
          el.id = 'opap-remote-voice-audio'
          el.autoplay = true
          el.playsInline = true
          el.style.display = 'none'
          document.body.appendChild(el)
        }
        this.audioElement = el
      }
    } catch {}

    try {
      p2pNetwork.onCallSignal((signal) => this.handleCallSignal(signal))
    } catch {}
  }

  private lastTerminationReason: 'declined' | 'ended' | 'missed' | 'normal' = 'normal'

  private clearCallTimeout(callId?: string) {
    if (callId && this.callTimeoutTimers.has(callId)) {
      clearTimeout(this.callTimeoutTimers.get(callId)!)
      this.callTimeoutTimers.delete(callId)
    }
    if (this.callTimeoutTimer) {
      clearTimeout(this.callTimeoutTimer)
      this.callTimeoutTimer = null
    }
  }

  private clearAllCallTimeouts() {
    this.callTimeoutTimers.forEach((timer) => clearTimeout(timer))
    this.callTimeoutTimers.clear()
    if (this.callTimeoutTimer) {
      clearTimeout(this.callTimeoutTimer)
      this.callTimeoutTimer = null
    }
  }

  private setCallTimeout(callId: string, callback: () => void, durationMs: number) {
    this.clearCallTimeout(callId)
    if (typeof window !== 'undefined') {
      const timer = window.setTimeout(callback, durationMs)
      this.callTimeoutTimers.set(callId, timer)
      this.callTimeoutTimer = timer
    }
  }

  public getCallState(): CallState {
    return this.callState
  }

  public getCurrentPeer(): Peer | null {
    if (this.activeCallId && this.sessions.has(this.activeCallId)) {
      return this.sessions.get(this.activeCallId)!.peer
    }
    return this.currentPeer
  }

  public getActivePeer(): Peer | null {
    if (this.activeCallId && this.sessions.has(this.activeCallId)) {
      return this.sessions.get(this.activeCallId)!.peer
    }
    return this.currentPeer
  }

  public getHeldPeer(): Peer | null {
    if (this.heldCallId && this.sessions.has(this.heldCallId)) {
      return this.sessions.get(this.heldCallId)!.peer
    }
    return null
  }

  public getIsConference(): boolean {
    return this.isConference
  }

  public getIsHeldByRemote(): boolean {
    return this.isHeldByRemote
  }

  public getSessions(): CallSession[] {
    return Array.from(this.sessions.values())
  }

  public getWaitingCall(): { signal: CallSignal; caller: Peer } | null {
    return this.waitingCall
  }

  public isMultiCall(): boolean {
    return (this.activeCallId !== null && this.heldCallId !== null) || this.isConference
  }

  public getIsMuted(): boolean {
    return this.isMuted
  }

  public getTerminationReason(): 'declined' | 'ended' | 'missed' | 'normal' {
    return this.lastTerminationReason
  }

  public setVolume(vol: number) {
    this.volumeLevel = Math.max(0, Math.min(1, vol))
    if (this.audioElement) {
      this.audioElement.volume = this.volumeLevel
    }
    this.audioElements.forEach((el) => {
      el.volume = this.volumeLevel
    })
    if (this.remoteGainNode) {
      this.remoteGainNode.gain.value = this.volumeLevel
    }
  }

  public setSystemTiming(callRingDurationSec: number, pageToneDurationSec: number | 'continuous') {
    this.callRingDurationMs = (callRingDurationSec || 30) * 1000
    this.pageToneDurationSec = pageToneDurationSec || 15
  }

  private notifyMultiCallChange() {
    const activeSession = this.activeCallId ? this.sessions.get(this.activeCallId) : null
    const heldSession = this.heldCallId ? this.sessions.get(this.heldCallId) : null
    const activePeer = activeSession?.peer || this.currentPeer
    const heldPeer = heldSession?.peer || null

    this.onMultiCallChangeCbs.forEach((cb) =>
      cb({
        activePeer,
        heldPeer,
        isConference: this.isConference,
        isHeldByRemote: this.isHeldByRemote,
        sessions: Array.from(this.sessions.values()),
        waitingCall: this.waitingCall,
      })
    )
  }

  /**
   * GSM Call Hold (Standby): Place active call on hold
   */
  public holdCall(callId?: string) {
    const targetCallId = callId || this.activeCallId || this.currentCallId
    if (!targetCallId) return
    const session = this.sessions.get(targetCallId)
    if (session) {
      session.state = 'held'
      if (session.audioElement) {
        session.audioElement.muted = true
      }
      const pc = this.connections.get(targetCallId)
      if (pc) {
        pc.getSenders().forEach((s) => {
          if (s.track) s.track.enabled = false
        })
      }
      p2pNetwork.sendCallSignal({
        type: 'call-hold',
        callId: targetCallId,
        callerId: p2pNetwork.getMyProfile().id,
        callerName: p2pNetwork.getMyProfile().name,
        callerExt: p2pNetwork.getMyProfile().ext,
        targetId: session.peer.id,
        targetExt: session.peer.ext,
        timestamp: Date.now(),
      })
    }
    sound.playHoldChime()
    this.heldCallId = targetCallId
    if (this.activeCallId === targetCallId) {
      this.activeCallId = null
    }
    this.notifyMultiCallChange()
  }

  /**
   * GSM Call Resume: Resume a held call to active
   */
  public resumeCall(callId?: string) {
    const targetCallId = callId || this.heldCallId
    if (!targetCallId) return
    const session = this.sessions.get(targetCallId)
    if (session) {
      session.state = 'active'
      if (session.audioElement) {
        session.audioElement.muted = false
        session.audioElement.play().catch(() => {})
      }
      const pc = this.connections.get(targetCallId)
      if (pc) {
        pc.getSenders().forEach((s) => {
          if (s.track) s.track.enabled = !this.isMuted
        })
      }
      p2pNetwork.sendCallSignal({
        type: 'call-resume',
        callId: targetCallId,
        callerId: p2pNetwork.getMyProfile().id,
        callerName: p2pNetwork.getMyProfile().name,
        callerExt: p2pNetwork.getMyProfile().ext,
        targetId: session.peer.id,
        targetExt: session.peer.ext,
        timestamp: Date.now(),
      })
      this.currentPeer = session.peer
      this.currentCallId = session.callId
    }
    sound.playResumeChime()
    if (this.heldCallId === targetCallId) {
      this.heldCallId = null
    }
    this.activeCallId = targetCallId
    this.applyMuteState()
    this.setCallState('active')
    this.notifyMultiCallChange()
  }

  /**
   * GSM Call Swap: Toggle between Active Call and Held Call (A <-> B)
   */
  public swapCalls() {
    if (!this.heldCallId || !this.activeCallId) return
    sound.playKeyClick()
    const previousActiveId = this.activeCallId
    const previousHeldId = this.heldCallId

    // 1. Hold currently active
    const activeSession = this.sessions.get(previousActiveId)
    if (activeSession) {
      activeSession.state = 'held'
      if (activeSession.audioElement) activeSession.audioElement.muted = true
      const pc = this.connections.get(previousActiveId)
      if (pc) {
        pc.getSenders().forEach((s) => {
          if (s.track) s.track.enabled = false
        })
      }
      p2pNetwork.sendCallSignal({
        type: 'call-hold',
        callId: previousActiveId,
        callerId: p2pNetwork.getMyProfile().id,
        callerName: p2pNetwork.getMyProfile().name,
        callerExt: p2pNetwork.getMyProfile().ext,
        targetId: activeSession.peer.id,
        targetExt: activeSession.peer.ext,
        timestamp: Date.now(),
      })
    }

    // 2. Resume previously held
    const heldSession = this.sessions.get(previousHeldId)
    if (heldSession) {
      heldSession.state = 'active'
      if (heldSession.audioElement) {
        heldSession.audioElement.muted = false
        heldSession.audioElement.play().catch(() => {})
      }
      const pc = this.connections.get(previousHeldId)
      if (pc) {
        pc.getSenders().forEach((s) => {
          if (s.track) s.track.enabled = !this.isMuted
        })
      }
      p2pNetwork.sendCallSignal({
        type: 'call-resume',
        callId: previousHeldId,
        callerId: p2pNetwork.getMyProfile().id,
        callerName: p2pNetwork.getMyProfile().name,
        callerExt: p2pNetwork.getMyProfile().ext,
        targetId: heldSession.peer.id,
        targetExt: heldSession.peer.ext,
        timestamp: Date.now(),
      })
      this.currentPeer = heldSession.peer
      this.currentCallId = heldSession.callId
    }

    this.activeCallId = previousHeldId
    this.heldCallId = previousActiveId
    this.applyMuteState()
    this.setCallState('active')
    this.notifyMultiCallChange()
  }

  /**
   * GSM Multiparty Conference (Merge): Combine Active & Held calls into 3-way conference
   */
  public mergeCalls() {
    if (this.sessions.size < 2) return
    sound.playRogerBeep()
    this.isConference = true
    const myProfile = p2pNetwork.getMyProfile()

    this.sessions.forEach((session, cId) => {
      session.state = 'active'
      session.isConference = true
      if (session.audioElement) {
        session.audioElement.muted = false
        session.audioElement.play().catch(() => {})
      }
      const pc = this.connections.get(cId)
      if (pc) {
        pc.getSenders().forEach((s) => {
          if (s.track) s.track.enabled = !this.isMuted
        })
      }
      p2pNetwork.sendCallSignal({
        type: 'call-conference',
        callId: cId,
        callerId: myProfile.id,
        callerName: myProfile.name,
        callerExt: myProfile.ext,
        targetId: session.peer.id,
        targetExt: session.peer.ext,
        timestamp: Date.now(),
      })
    })

    this.applyMuteState()
    this.activeCallId = Array.from(this.sessions.keys())[0] || null
    this.heldCallId = null
    this.setCallState('active')
    this.notifyMultiCallChange()
  }

  /**
   * GSM Call Waiting Action: Hold Current Active Call and Answer Incoming Call
   */
  public async holdAndAnswer(signal: CallSignal, caller: Peer) {
    sound.stopAllCallTones()
    this.waitingCall = null

    // Put current active call on hold
    if (this.activeCallId) {
      this.holdCall(this.activeCallId)
    }

    // Accept incoming call
    await this.acceptCallSession(signal, caller)
  }

  /**
   * GSM Call Waiting Action: End Current Active Call and Answer Incoming Call
   */
  public async endAndAnswer(signal: CallSignal, caller: Peer) {
    sound.stopAllCallTones()
    this.waitingCall = null

    // Drop active call
    if (this.activeCallId) {
      this.endCall(this.activeCallId)
    }

    // Accept incoming call
    await this.acceptCallSession(signal, caller)
  }

  /**
   * GSM Call Waiting Action: Decline Incoming Call without disturbing active call
   */
  public declineWaitingCall() {
    sound.stopAllCallTones()
    if (this.waitingCall) {
      const { signal } = this.waitingCall
      const myProfile = p2pNetwork.getMyProfile()
      p2pNetwork.sendCallSignal({
        type: 'call-reject',
        callId: signal.callId,
        callerId: myProfile.id,
        callerName: myProfile.name,
        callerExt: myProfile.ext,
        targetId: signal.callerId,
        targetExt: signal.callerExt,
        timestamp: Date.now(),
      })
      this.waitingCall = null
      this.notifyMultiCallChange()
    }
  }

  /**
   * Initiate Outgoing Voice Call (GSM rules: if active, hold current active call first)
  /**
   * Initiate 1-to-1 or multi-party Voice Call
   * GSM Rule: Caller can initiate a 2nd call as standby (putting current call on hold)
   * or directly as conference (keeping all parties connected).
   */
  public async initiateCall(targetPeer: Peer, options?: { asConference?: boolean }) {
    if (!targetPeer || targetPeer.name === 'UNASSIGNED' || targetPeer.id.startsWith('unassigned-')) {
      console.warn(`[VoiceCall] Cannot call unassigned peer (EXT ${targetPeer?.ext})`)
      sound.playDisconnectTone()
      return
    }
    if (this.callState === 'calling' || this.callState === 'paging' || this.callState === 'receiving-page') return

    // GSM Telephony Rule:
    // If adding as conference, keep existing calls active!
    // Otherwise, place current active call on hold before dialing second party.
    if (options?.asConference) {
      this.isConference = true
    } else if (this.callState === 'active' && this.currentCallId) {
      this.holdCall(this.currentCallId)
    }

    this.lastTerminationReason = 'normal'
    this.pendingCandidates = []

    const callId = `call-${Date.now()}`
    this.currentCallId = callId
    this.currentPeer = targetPeer
    this.activeCallId = callId

    this.sessions.set(callId, {
      callId,
      peer: targetPeer,
      state: 'calling',
      startTime: Date.now(),
      isInitiator: true,
    })

    this.setCallState('calling')
    this.notifyMultiCallChange()

    sound.startRingback()

    const myProfile = p2pNetwork.getMyProfile()

    // Request microphone access with echo cancellation & noise suppression
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        })
        this.setupAudioAnalyser(this.localStream)
        this.applyMuteState()
      }
    } catch (err) {
      console.warn('Microphone permission not granted, proceeding in simulated audio mode', err)
    }

    // Send call request signal with full caller & target identity and pre-set ring duration
    p2pNetwork.sendCallSignal({
      type: 'call-request',
      callId,
      callerId: myProfile.id,
      callerName: myProfile.name,
      callerExt: myProfile.ext,
      targetId: targetPeer.id,
      targetExt: targetPeer.ext,
      callRingDuration: Math.round(this.callRingDurationMs / 1000),
      timestamp: Date.now(),
    })

    // Configurable Auto-Timeout on Call Initiator (Strictly matching pre-set duration)
    this.setCallTimeout(
      callId,
      () => {
        const session = this.sessions.get(callId)
        if (session && session.state === 'calling') {
          this.lastTerminationReason = 'missed'
          this.endCall(callId)
        }
      },
      this.callRingDurationMs
    )

    // If calling simulated peer fallback
    if (targetPeer.isSimulated) {
      setTimeout(() => {
        if (this.callState === 'calling' && this.currentCallId === callId) {
          sound.stopRingback()
          sound.playRogerBeep()
          const session = this.sessions.get(callId)
          if (session) session.state = 'active'
          this.setCallState('active')
          this.startSimulatedAudioWave()
          this.notifyMultiCallChange()
        }
      }, 2500)
    }
  }

  /**
   * Direct Pager Alert with Configurable Duration (or Continuous)
   */
  /**
   * Add Participant to Active Call:
   * mode = 'standby' -> puts current active call on hold, dials new participant
   * mode = 'conference' -> dials new participant directly into group conference
   */
  public async addParticipant(targetPeer: Peer, mode: 'standby' | 'conference' = 'standby') {
    if (!targetPeer || targetPeer.name === 'UNASSIGNED' || targetPeer.id.startsWith('unassigned-')) {
      console.warn(`[VoiceCall] Cannot add unassigned peer (EXT ${targetPeer?.ext}) to call`)
      sound.playDisconnectTone()
      return
    }
    await this.initiateCall(targetPeer, { asConference: mode === 'conference' })
  }

  public async initiatePage(targetPeer: Peer) {
    if (!targetPeer || targetPeer.name === 'UNASSIGNED' || targetPeer.id.startsWith('unassigned-')) {
      console.warn(`[VoiceCall] Cannot page unassigned peer (EXT ${targetPeer?.ext})`)
      sound.playDisconnectTone()
      return
    }
    if (this.callState !== 'idle') return

    const callId = `page-${Date.now()}`
    this.currentCallId = callId
    this.currentPeer = targetPeer
    this.setCallState('paging')

    sound.playDtmf('5')

    const myProfile = p2pNetwork.getMyProfile()

    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        this.setupAudioAnalyser(this.localStream)
      }
    } catch {}

    p2pNetwork.sendCallSignal({
      type: 'page-alert',
      callId,
      callerId: myProfile.id,
      callerName: myProfile.name,
      callerExt: myProfile.ext,
      targetId: targetPeer.id,
      targetExt: targetPeer.ext,
      pageToneDuration: this.pageToneDurationSec,
      timestamp: Date.now(),
    })

    // Configurable Auto-Timeout on Initiator (Unless Continuous, strictly matching pre-set duration)
    if (typeof window !== 'undefined' && this.pageToneDurationSec !== 'continuous') {
      const ms = typeof this.pageToneDurationSec === 'number' ? this.pageToneDurationSec * 1000 : 15000
      if (this.pageTimeoutTimer) clearTimeout(this.pageTimeoutTimer)
      this.pageTimeoutTimer = window.setTimeout(() => {
        if (this.callState === 'paging') {
          const target = this.currentPeer
          this.cancelPage()
          if (target) {
            this.onPageTimeoutCbs.forEach((cb) => cb(target, true))
          }
        }
      }, ms)
    }

    // Simulated peer auto-accept fallback
    if (targetPeer.isSimulated) {
      setTimeout(() => {
        if (this.callState === 'paging' && this.currentCallId === callId) {
          if (this.pageTimeoutTimer) clearTimeout(this.pageTimeoutTimer)
          sound.playRogerBeep()
          this.setCallState('active')
          this.startSimulatedAudioWave()
        }
      }, 3000)
    }
  }

  public cancelPage() {
    if (this.pageTimeoutTimer) {
      clearTimeout(this.pageTimeoutTimer)
      this.pageTimeoutTimer = null
    }

    if (this.currentPeer && this.currentCallId) {
      const myProfile = p2pNetwork.getMyProfile()
      p2pNetwork.sendCallSignal({
        type: 'page-cancel',
        callId: this.currentCallId,
        callerId: myProfile.id,
        callerName: myProfile.name,
        callerExt: myProfile.ext,
        targetId: this.currentPeer.id,
        targetExt: this.currentPeer.ext,
        timestamp: Date.now(),
      })
    }

    this.cleanupCall()
    this.setCallState('idle')
    this.currentPeer = null
    this.currentCallId = null
  }

  public async acceptIncomingPage(note?: string) {
    if (this.callState !== 'receiving-page' || !this.currentPeer || !this.currentCallId) return

    if (this.pageTimeoutTimer) {
      clearTimeout(this.pageTimeoutTimer)
      this.pageTimeoutTimer = null
    }

    sound.stopPagerBeep()
    sound.playRogerBeep()

    const myProfile = p2pNetwork.getMyProfile()
    const targetPeer = this.currentPeer
    const callId = this.currentCallId

    p2pNetwork.sendCallSignal({
      type: 'page-accept',
      callId,
      callerId: myProfile.id,
      callerName: myProfile.name,
      callerExt: myProfile.ext,
      targetId: targetPeer.id,
      targetExt: targetPeer.ext,
      note,
      timestamp: Date.now(),
    })

    // Reset to idle without initiating voice call
    this.cleanupCall()
    this.setCallState('idle')
    this.currentPeer = null
    this.currentCallId = null
  }

  public declineIncomingPage(note?: string) {
    if (this.pageTimeoutTimer) {
      clearTimeout(this.pageTimeoutTimer)
      this.pageTimeoutTimer = null
    }

    sound.stopPagerBeep()

    if (this.currentPeer && this.currentCallId) {
      const myProfile = p2pNetwork.getMyProfile()
      p2pNetwork.sendCallSignal({
        type: 'page-decline',
        callId: this.currentCallId,
        callerId: myProfile.id,
        callerName: myProfile.name,
        callerExt: myProfile.ext,
        targetId: this.currentPeer.id,
        targetExt: this.currentPeer.ext,
        note,
        timestamp: Date.now(),
      })
    }

    this.cleanupCall()
    this.setCallState('idle')
    this.currentPeer = null
    this.currentCallId = null
  }

  public async acceptCallSession(signal: CallSignal, caller: Peer) {
    this.clearCallTimeout(signal.callId)

    this.pendingCandidates = []
    sound.stopAllCallTones()
    sound.playRogerBeep()

    const myProfile = p2pNetwork.getMyProfile()
    const callId = signal.callId

    try {
      if (!this.localStream && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 48000,
          },
          video: false,
        })
        this.setupAudioAnalyser(this.localStream)
        this.applyMuteState()
      }
    } catch (err) {
      console.warn('Receiver mic acquisition error', err)
    }

    p2pNetwork.sendCallSignal({
      type: 'call-accept',
      callId,
      callerId: myProfile.id,
      callerName: myProfile.name,
      callerExt: myProfile.ext,
      targetId: caller.id,
      targetExt: caller.ext,
      timestamp: Date.now(),
    })

    this.sessions.set(callId, {
      callId,
      peer: caller,
      state: 'active',
      startTime: Date.now(),
      isInitiator: false,
    })
    this.activeCallId = callId
    this.currentPeer = caller
    this.currentCallId = callId

    this.setCallState('active')
    this.startSimulatedAudioWave()
    this.notifyMultiCallChange()
    await this.setupPeerConnection(caller.id, caller.ext, false, callId)
  }

  public async acceptIncomingCall(signal?: CallSignal, caller?: Peer) {
    const callId = signal?.callId || this.currentCallId
    const targetCaller = caller || this.currentPeer
    if (!callId || !targetCaller) return

    await this.acceptCallSession(
      signal || {
        callId,
        callerId: targetCaller.id,
        callerName: targetCaller.name,
        callerExt: targetCaller.ext,
        targetId: '',
        targetExt: '',
        timestamp: Date.now(),
        type: 'call-accept',
      },
      targetCaller
    )
  }

  public rejectIncomingCall() {
    this.lastTerminationReason = 'declined'
    sound.stopAllCallTones()
    if (this.currentCallId) {
      this.clearCallTimeout(this.currentCallId)
    }
    if (this.currentPeer && this.currentCallId) {
      const myProfile = p2pNetwork.getMyProfile()
      p2pNetwork.sendCallSignal({
        type: 'call-reject',
        callId: this.currentCallId,
        callerId: myProfile.id,
        callerName: myProfile.name,
        callerExt: myProfile.ext,
        targetId: this.currentPeer.id,
        targetExt: this.currentPeer.ext,
        timestamp: Date.now(),
      })
    }
    this.cleanupCall()
    this.setCallState('idle')
    this.currentPeer = null
    this.currentCallId = null
    this.notifyMultiCallChange()
  }

  public endActiveCall() {
    if (this.activeCallId) {
      this.endCall(this.activeCallId)
    } else {
      this.endCall()
    }
  }

  public endAllCalls() {
    this.endCall()
  }

  public endCall(callId?: string) {
    sound.stopAllCallTones()
    sound.playDisconnectTone()

    if (this.pageTimeoutTimer) {
      clearTimeout(this.pageTimeoutTimer)
      this.pageTimeoutTimer = null
    }

    if (callId) {
      this.clearCallTimeout(callId)
    } else {
      this.clearAllCallTimeouts()
    }

    const myProfile = p2pNetwork.getMyProfile()

    // Specific Session End (GSM Hold/Active call hangup)
    if (callId && this.sessions.has(callId)) {
      const session = this.sessions.get(callId)!
      p2pNetwork.sendCallSignal({
        type: 'call-end',
        callId,
        callerId: myProfile.id,
        callerName: myProfile.name,
        callerExt: myProfile.ext,
        targetId: session.peer.id,
        targetExt: session.peer.ext,
        timestamp: Date.now(),
      })

      if (session.audioElement) {
        session.audioElement.srcObject = null
        session.audioElement.remove()
      }
      const pc = this.connections.get(callId)
      if (pc) {
        try { pc.close() } catch {}
        this.connections.delete(callId)
      }
      this.sessions.delete(callId)
      this.audioElements.delete(callId)

      // If ended session was active and a held session exists, automatically resume the held call!
      if (this.activeCallId === callId) {
        this.activeCallId = null
        if (this.heldCallId && this.sessions.has(this.heldCallId)) {
          this.resumeCall(this.heldCallId)
          return
        } else if (this.sessions.size > 0) {
          const firstKey = Array.from(this.sessions.keys())[0]
          this.resumeCall(firstKey)
          return
        }
      } else if (this.heldCallId === callId) {
        this.heldCallId = null
      }

      if (this.sessions.size === 0) {
        this.cleanupCall()
        this.setCallState('ended')
        setTimeout(() => {
          this.currentPeer = null
          this.currentCallId = null
          this.activeCallId = null
          this.heldCallId = null
          this.isConference = false
          this.isHeldByRemote = false
          this.setCallState('idle')
          this.notifyMultiCallChange()
        }, 1200)
      } else {
        this.notifyMultiCallChange()
      }
      return
    }

    // End ALL Sessions
    this.sessions.forEach((session, cId) => {
      p2pNetwork.sendCallSignal({
        type: 'call-end',
        callId: cId,
        callerId: myProfile.id,
        callerName: myProfile.name,
        callerExt: myProfile.ext,
        targetId: session.peer.id,
        targetExt: session.peer.ext,
        timestamp: Date.now(),
      })
      if (session.audioElement) {
        session.audioElement.srcObject = null
        session.audioElement.remove()
      }
    })

    this.connections.forEach((pc) => {
      try { pc.close() } catch {}
    })
    this.connections.clear()
    this.audioElements.clear()
    this.sessions.clear()
    this.activeCallId = null
    this.heldCallId = null
    this.isConference = false
    this.isHeldByRemote = false
    this.waitingCall = null

    const targetPeer = this.currentPeer
    const fallbackCallId = this.currentCallId || `call-${Date.now()}`

    if (targetPeer) {
      p2pNetwork.sendCallSignal({
        type: 'call-end',
        callId: fallbackCallId,
        callerId: myProfile.id,
        callerName: myProfile.name,
        callerExt: myProfile.ext,
        targetId: targetPeer.id,
        targetExt: targetPeer.ext,
        timestamp: Date.now(),
      })
    }

    this.cleanupCall()
    this.setCallState('ended')

    setTimeout(() => {
      this.currentPeer = null
      this.currentCallId = null
      this.setCallState('idle')
      this.notifyMultiCallChange()
    }, 1200)
  }

  public applyMuteState() {
    const micActive = !this.isMuted || this.isPttActive

    // 1. Set all audio tracks on localStream
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = micActive
      })
    }

    // 2. Set all senders across ALL peer connections (Group / 3-Way Conference / Standby)
    this.connections.forEach((pc, cId) => {
      try {
        const session = this.sessions.get(cId)
        const isSessionHeld = session && session.state === 'held'
        pc.getSenders().forEach((sender) => {
          if (sender.track && sender.track.kind === 'audio') {
            sender.track.enabled = isSessionHeld ? false : micActive
          }
        })
      } catch (err) {
        console.warn(`[VoiceCall] Error applying mute state to connection ${cId}:`, err)
      }
    })

    // 3. Fallback peerConnection
    if (this.peerConnection) {
      try {
        this.peerConnection.getSenders().forEach((sender) => {
          if (sender.track && sender.track.kind === 'audio') {
            sender.track.enabled = micActive
          }
        })
      } catch {}
    }

    // 4. Silence VU meter level when muted
    if (!micActive) {
      this.audioLevel = 0
      this.onAudioLevelCbs.forEach((cb) => cb(0))
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted
    this.applyMuteState()
    return this.isMuted
  }

  public setMute(muted: boolean): boolean {
    this.isMuted = muted
    this.applyMuteState()
    return this.isMuted
  }

  public startPtt() {
    if (this.callState !== 'active') return
    this.isPttActive = true
    this.applyMuteState()
    sound.playKeyClick()
  }

  public stopPtt() {
    if (this.callState !== 'active') return
    this.isPttActive = false
    this.applyMuteState()
    sound.playRogerBeep()
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return null
    if (!this.audioCtx) {
      this.audioCtx = new AudioCtx()
    }
    return this.audioCtx
  }

  private playRemoteAudioForSession(stream: MediaStream, callId: string) {
    try {
      if (typeof document !== 'undefined') {
        let el = this.audioElements.get(callId)
        if (!el) {
          el = document.createElement('audio')
          el.id = `opap-audio-${callId}`
          el.autoplay = true
          el.playsInline = true
          el.style.display = 'none'
          document.body.appendChild(el)
          this.audioElements.set(callId, el)
        }
        if (el.srcObject !== stream) {
          el.srcObject = stream
        }
        el.volume = this.volumeLevel
        const session = this.sessions.get(callId)
        if (session) {
          session.audioElement = el
          session.remoteStream = stream
          el.muted = session.state === 'held'
        }
        el.play().catch((err) => {
          console.warn('Audio playback error:', err)
        })
        this.audioElement = el
      }
    } catch (e) {
      console.error('Error playing remote audio:', e)
    }
  }

  private playRemoteAudio(stream: MediaStream) {
    this.playRemoteAudioForSession(stream, this.currentCallId || 'default')
  }

  private async drainPendingCandidates(callId?: string) {
    const cId = callId || this.currentCallId
    if (!cId) return
    const pc = this.connections.get(cId) || this.peerConnection
    if (!pc || !pc.remoteDescription) return
    const queue = this.pendingCandidatesMap.get(cId) || this.pendingCandidates
    while (queue.length > 0) {
      const cand = queue.shift()
      if (cand) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand))
        } catch (e) {
          console.warn('ICE candidate addition error', e)
        }
      }
    }
  }

  private async setupPeerConnection(
    targetId: string,
    targetExt: string,
    isInitiator: boolean,
    callId?: string
  ) {
    const cId = callId || this.currentCallId || `call-${Date.now()}`
    try {
      if (typeof RTCPeerConnection === 'undefined') return

      const existingPc = this.connections.get(cId)
      if (existingPc) {
        try {
          existingPc.close()
        } catch {}
        this.connections.delete(cId)
      }

      const pc = new RTCPeerConnection(this.rtcConfig)
      this.connections.set(cId, pc)
      this.peerConnection = pc

      // Ensure local microphone tracks are available and attached with optimal voice settings
      if (!this.localStream && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
              sampleRate: 48000,
            },
            video: false,
          })
          this.setupAudioAnalyser(this.localStream)
        } catch {}
      }

      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          pc.addTrack(track, this.localStream!)
        })
      } else {
        try {
          pc.addTransceiver('audio', { direction: 'sendrecv' })
        } catch {}
      }

      this.applyMuteState()

      pc.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track])
        this.remoteStreams.set(cId, stream)
        this.remoteStream = stream
        this.playRemoteAudioForSession(stream, cId)
        this.setupAudioAnalyser(stream)
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const myProfile = p2pNetwork.getMyProfile()
          p2pNetwork.sendCallSignal({
            type: 'ice-candidate',
            callId: cId,
            callerId: myProfile.id,
            callerName: myProfile.name,
            callerExt: myProfile.ext,
            targetId,
            targetExt,
            candidate: event.candidate.toJSON(),
            timestamp: Date.now(),
          })
        }
      }

      if (isInitiator) {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
        })
        await pc.setLocalDescription(offer)

        const myProfile = p2pNetwork.getMyProfile()
        p2pNetwork.sendCallSignal({
          type: 'offer',
          callId: cId,
          callerId: myProfile.id,
          callerName: myProfile.name,
          callerExt: myProfile.ext,
          targetId,
          targetExt,
          sdp: offer,
          timestamp: Date.now(),
        })
      }
    } catch (err) {
      console.error('Error setupPeerConnection:', err)
    }
  }

  private async handleCallSignal(signal: CallSignal) {
    console.log(
      `[VoiceCall] handleCallSignal: type=${signal.type}, callId=${signal.callId}, currentState=${this.callState}, currentCallId=${this.currentCallId}`
    )
    switch (signal.type) {
      case 'call-request': {
        if (this.currentCallId === signal.callId && this.callState === 'active') {
          // Already connected to this active call
          break
        }
        if (this.callState === 'idle') {
          this.setCallState('ringing')
          sound.startIncomingRingtone()
          const caller: Peer = {
            id: signal.callerId,
            name: signal.callerName,
            full: signal.callerName,
            ext: signal.callerExt,
            status: 'busy',
            lastSeen: Date.now(),
          }
          this.currentPeer = caller
          this.currentCallId = signal.callId
          this.onIncomingCallCbs.forEach((cb) => cb(signal, caller))

          // Recipient Ring Duration Timeout matching pre-set duration
          const ringDurationMs = signal.callRingDuration
            ? signal.callRingDuration * 1000
            : this.callRingDurationMs

          this.setCallTimeout(
            signal.callId,
            () => {
              if (this.callState === 'ringing' && this.currentCallId === signal.callId) {
                this.lastTerminationReason = 'missed'
                sound.stopAllCallTones()
                this.cleanupCall()
                this.setCallState('idle')
                this.currentPeer = null
                this.currentCallId = null
              }
            },
            ringDurationMs
          )
        } else if (this.callState === 'active' || this.isMultiCall()) {
          // GSM Call Waiting (CW): Incoming call while already in active/held call
          const caller: Peer = {
            id: signal.callerId,
            name: signal.callerName,
            full: signal.callerName,
            ext: signal.callerExt,
            status: 'busy',
            lastSeen: Date.now(),
          }
          this.waitingCall = { signal, caller }
          sound.startCallWaitingTone()
          this.onCallWaitingCbs.forEach((cb) => cb(signal, caller))
          this.notifyMultiCallChange()
          break
        } else if (this.callState === 'calling' && this.currentPeer?.ext === signal.callerExt) {
          // Cross-calling tie-break: ignore duplicate request
          break
        } else if (
          !this.sessions.has(signal.callId) &&
          this.callState !== 'active' &&
          this.callState !== 'calling' &&
          !this.isMultiCall() &&
          this.currentCallId !== signal.callId
        ) {
          const myProfile = p2pNetwork.getMyProfile()
          p2pNetwork.sendCallSignal({
            type: 'call-reject',
            callId: signal.callId,
            callerId: myProfile.id,
            callerName: myProfile.name,
            callerExt: myProfile.ext,
            targetId: signal.callerId,
            targetExt: signal.callerExt,
            timestamp: Date.now(),
          })
        }
        break
      }

      case 'call-hold': {
        console.log(`[VoiceCall] Received call-hold for callId: ${signal.callId}`)
        this.clearCallTimeout(signal.callId)
        sound.stopAllCallTones()
        sound.playHoldChime()
        this.isHeldByRemote = true
        const session = this.sessions.get(signal.callId)
        if (session) {
          session.state = 'held'
          if (session.audioElement) session.audioElement.muted = true
        }
        this.notifyMultiCallChange()
        break
      }

      case 'call-resume': {
        console.log(`[VoiceCall] Received call-resume for callId: ${signal.callId}`)
        this.clearCallTimeout(signal.callId)
        sound.stopAllCallTones()
        sound.playResumeChime()
        this.isHeldByRemote = false
        const session = this.sessions.get(signal.callId)
        if (session) {
          session.state = 'active'
          if (session.audioElement) {
            session.audioElement.muted = false
            session.audioElement.play().catch(() => {})
          }
        }
        this.notifyMultiCallChange()
        break
      }

      case 'call-conference': {
        console.log(`[VoiceCall] Received call-conference for callId: ${signal.callId}`)
        this.clearCallTimeout(signal.callId)
        sound.stopAllCallTones()
        sound.playRogerBeep()
        this.isConference = true
        this.isHeldByRemote = false
        const session = this.sessions.get(signal.callId)
        if (session) {
          session.state = 'active'
          session.isConference = true
          if (session.audioElement) {
            session.audioElement.muted = false
            session.audioElement.play().catch(() => {})
          }
        }
        this.applyMuteState()
        this.notifyMultiCallChange()
        break
      }

      case 'page-alert': {
        if (this.callState === 'idle') {
          this.setCallState('receiving-page')
          const pageDuration =
            signal.pageToneDuration !== undefined ? signal.pageToneDuration : this.pageToneDurationSec

          sound.startPagerBeep(pageDuration)
          const caller: Peer = {
            id: signal.callerId,
            name: signal.callerName,
            full: signal.callerName,
            ext: signal.callerExt,
            status: 'busy',
            lastSeen: Date.now(),
          }
          this.currentPeer = caller
          this.currentCallId = signal.callId
          this.onIncomingPageCbs.forEach((cb) => cb(signal, caller))

          // Recipient Pager Tone Timeout matching pre-set duration (unless Continuous)
          if (typeof window !== 'undefined' && pageDuration !== 'continuous') {
            const ms = typeof pageDuration === 'number' ? pageDuration * 1000 : 15000
            if (this.pageTimeoutTimer) clearTimeout(this.pageTimeoutTimer)
            this.pageTimeoutTimer = window.setTimeout(() => {
              if (this.callState === 'receiving-page' && this.currentCallId === signal.callId) {
                const callerPeer = this.currentPeer
                sound.stopPagerBeep()
                this.cleanupCall()
                this.setCallState('idle')
                this.currentPeer = null
                this.currentCallId = null
                if (callerPeer) {
                  this.onPageTimeoutCbs.forEach((cb) => cb(callerPeer, false))
                }
              }
            }, ms)
          }
        } else {
          const myProfile = p2pNetwork.getMyProfile()
          p2pNetwork.sendCallSignal({
            type: 'page-decline',
            callId: signal.callId,
            callerId: myProfile.id,
            callerName: myProfile.name,
            callerExt: myProfile.ext,
            targetId: signal.callerId,
            targetExt: signal.callerExt,
            timestamp: Date.now(),
          })
        }
        break
      }

      case 'page-accept': {
        const callerPeer = this.currentPeer
        if (this.callState === 'paging') {
          if (this.pageTimeoutTimer) {
            clearTimeout(this.pageTimeoutTimer)
            this.pageTimeoutTimer = null
          }
          sound.playRogerBeep()
          this.cleanupCall()
          this.setCallState('idle')
          this.currentPeer = null
          this.currentCallId = null
          if (callerPeer) {
            this.onPageResponseCbs.forEach((cb) => cb(callerPeer, 'accepted', signal.note))
          }
        }
        break
      }

      case 'page-decline':
      case 'page-cancel': {
        const callerPeer = this.currentPeer
        if (this.pageTimeoutTimer) {
          clearTimeout(this.pageTimeoutTimer)
          this.pageTimeoutTimer = null
        }
        sound.stopPagerBeep()
        sound.playDisconnectTone()
        this.cleanupCall()
        this.setCallState('idle')
        this.currentPeer = null
        this.currentCallId = null
        if (callerPeer && signal.type === 'page-decline') {
          this.onPageResponseCbs.forEach((cb) => cb(callerPeer, 'declined', signal.note))
        }
        break
      }

      case 'call-accept': {
        console.log(
          `[VoiceCall] ✅ call-accept received! Transitioning caller to ACTIVE state. callId=${signal.callId}`
        )
        this.clearCallTimeout(signal.callId)
        sound.stopAllCallTones()
        sound.playRogerBeep()
        if (signal.callerId && signal.callerExt) {
          const peer = {
            id: signal.callerId,
            name: signal.callerName,
            full: signal.callerName,
            ext: signal.callerExt,
            status: 'busy' as const,
            lastSeen: Date.now(),
          }
          this.currentPeer = peer
          this.sessions.set(signal.callId, {
            callId: signal.callId,
            peer,
            state: 'active',
            startTime: Date.now(),
            isInitiator: true,
          })
          this.activeCallId = signal.callId
        }
        this.currentCallId = signal.callId
        this.setCallState('active')
        this.startSimulatedAudioWave()
        if (this.isConference) {
          this.mergeCalls()
        } else {
          this.notifyMultiCallChange()
        }
        await this.setupPeerConnection(signal.callerId, signal.callerExt, true, signal.callId)
        break
      }

      case 'call-reject': {
        this.clearCallTimeout(signal.callId)
        if (signal.callId && this.currentCallId && signal.callId !== this.currentCallId && !this.sessions.has(signal.callId)) {
          // Reject for another or older call session - ignore
          break
        }
        if (this.callState === 'active' || this.isMultiCall()) {
          // If in active multi-call, only remove the rejected participant session
          if (signal.callId && this.sessions.has(signal.callId)) {
            const s = this.sessions.get(signal.callId)
            if (s?.audioElement) {
              s.audioElement.srcObject = null
              s.audioElement.remove()
            }
            this.connections.get(signal.callId)?.close()
            this.connections.delete(signal.callId)
            this.sessions.delete(signal.callId)
            this.audioElements.delete(signal.callId)
            this.notifyMultiCallChange()
          }
          break
        }
        this.lastTerminationReason = 'declined'
        sound.stopAllCallTones()
        sound.playDisconnectTone()
        this.cleanupCall()
        this.setCallState('ended')

        setTimeout(() => {
          this.currentPeer = null
          this.currentCallId = null
          this.setCallState('idle')
        }, 1200)
        break
      }

      case 'call-end': {
        this.lastTerminationReason = 'ended'
        this.clearCallTimeout(signal.callId)
        sound.stopAllCallTones()
        sound.playDisconnectTone()

        // Clean up specific session if found
        if (signal.callId && this.sessions.has(signal.callId)) {
          const s = this.sessions.get(signal.callId)!
          if (s.audioElement) {
            s.audioElement.srcObject = null
            s.audioElement.remove()
          }
          const pc = this.connections.get(signal.callId)
          if (pc) {
            try {
              pc.close()
            } catch {}
            this.connections.delete(signal.callId)
          }
          this.sessions.delete(signal.callId)
          this.audioElements.delete(signal.callId)

          // If ended session was active and held session exists, resume held call!
          if (this.activeCallId === signal.callId) {
            this.activeCallId = null
            if (this.heldCallId && this.sessions.has(this.heldCallId)) {
              this.resumeCall(this.heldCallId)
              return
            } else if (this.sessions.size > 0) {
              const firstKey = Array.from(this.sessions.keys())[0]
              this.resumeCall(firstKey)
              return
            }
          } else if (this.heldCallId === signal.callId) {
            this.heldCallId = null
          }
        }

        if (this.sessions.size === 0) {
          this.cleanupCall()
          this.setCallState('ended')

          setTimeout(() => {
            this.currentPeer = null
            this.currentCallId = null
            this.activeCallId = null
            this.heldCallId = null
            this.isConference = false
            this.isHeldByRemote = false
            this.setCallState('idle')
            this.notifyMultiCallChange()
          }, 1200)
        } else {
          this.notifyMultiCallChange()
        }
        break
      }

      case 'offer': {
        if (signal.sdp) {
          this.clearCallTimeout(signal.callId)
          sound.stopAllCallTones()
          if (signal.callerId && signal.callerExt) {
            const peer = {
              id: signal.callerId,
              name: signal.callerName,
              full: signal.callerName,
              ext: signal.callerExt,
              status: 'busy' as const,
              lastSeen: Date.now(),
            }
            this.currentPeer = peer
            this.sessions.set(signal.callId, {
              callId: signal.callId,
              peer,
              state: 'active',
              startTime: Date.now(),
              isInitiator: false,
            })
            if (!this.activeCallId) this.activeCallId = signal.callId
          }
          this.currentCallId = signal.callId
          this.setCallState('active')
          this.startSimulatedAudioWave()
          this.notifyMultiCallChange()

          let pc = this.connections.get(signal.callId)
          if (!pc) {
            await this.setupPeerConnection(signal.callerId, signal.callerExt, false, signal.callId)
            pc = this.connections.get(signal.callId)
          }
          if (pc) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
              await this.drainPendingCandidates(signal.callId)

              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)

              const myProfile = p2pNetwork.getMyProfile()
              p2pNetwork.sendCallSignal({
                type: 'answer',
                callId: signal.callId,
                callerId: myProfile.id,
                callerName: myProfile.name,
                callerExt: myProfile.ext,
                targetId: signal.callerId,
                targetExt: signal.callerExt,
                sdp: answer,
                timestamp: Date.now(),
              })
            } catch (err) {
              console.warn('Error handling WebRTC offer:', err)
            }
          }
        }
        break
      }

      case 'answer': {
        if (signal.sdp) {
          this.clearCallTimeout(signal.callId)
          sound.stopAllCallTones()
          const pc = this.connections.get(signal.callId) || this.peerConnection
          if (pc) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
              await this.drainPendingCandidates(signal.callId)
            } catch (e) {
              console.warn('Error handling WebRTC answer:', e)
            }
          }
        }
        break
      }

      case 'ice-candidate': {
        if (signal.candidate) {
          const pc = this.connections.get(signal.callId) || this.peerConnection
          if (pc && pc.remoteDescription && pc.remoteDescription.type) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(signal.candidate))
            } catch (e) {
              console.warn('ICE candidate error', e)
            }
          } else {
            let queue = this.pendingCandidatesMap.get(signal.callId)
            if (!queue) {
              queue = []
              this.pendingCandidatesMap.set(signal.callId, queue)
            }
            queue.push(signal.candidate)
          }
        }
        break
      }
    }
  }

  private setupAudioAnalyser(stream: MediaStream) {
    try {
      if (typeof window === 'undefined') return
      const ctx = this.getAudioContext()
      if (!ctx) return

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }

      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 64
      this.micSource = ctx.createMediaStreamSource(stream)
      this.micSource.connect(this.analyser)

      const buffer = new Uint8Array(this.analyser.frequencyBinCount)

      const updateLevel = () => {
        if (this.callState !== 'active') return
        if (this.isMuted && !this.isPttActive) {
          this.audioLevel = 0
          this.onAudioLevelCbs.forEach((cb) => cb(0))
          this.audioAnimFrame = requestAnimationFrame(updateLevel)
          return
        }
        this.analyser?.getByteFrequencyData(buffer)
        let sum = 0
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i]
        }
        const avg = sum / buffer.length
        this.audioLevel = Math.min(100, Math.round((avg / 255) * 100 * 2))
        this.onAudioLevelCbs.forEach((cb) => cb(this.audioLevel))
        this.audioAnimFrame = requestAnimationFrame(updateLevel)
      }

      updateLevel()
    } catch {}
  }

  private startSimulatedAudioWave() {
    const updateSimulated = () => {
      if (this.callState !== 'active') return
      if (this.isMuted && !this.isPttActive) {
        this.audioLevel = 0
        this.onAudioLevelCbs.forEach((cb) => cb(0))
        this.audioAnimFrame = requestAnimationFrame(updateSimulated)
        return
      }
      const base = 40 + Math.sin(Date.now() / 200) * 30 + Math.random() * 20
      this.audioLevel = Math.round(base)
      this.onAudioLevelCbs.forEach((cb) => cb(this.audioLevel))
      this.audioAnimFrame = requestAnimationFrame(updateSimulated)
    }
    updateSimulated()
  }

  private cleanupCall() {
    if (this.audioAnimFrame) {
      cancelAnimationFrame(this.audioAnimFrame)
      this.audioAnimFrame = null
    }

    if (this.peerConnection) {
      try {
        this.peerConnection.close()
      } catch {}
      this.peerConnection = null
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop())
      this.localStream = null
    }

    if (this.audioElement) {
      this.audioElement.srcObject = null
    }

    if (this.remoteSource) {
      try {
        this.remoteSource.disconnect()
      } catch {}
      this.remoteSource = null
    }

    if (this.remoteGainNode) {
      try {
        this.remoteGainNode.disconnect()
      } catch {}
      this.remoteGainNode = null
    }

    this.pendingCandidates = []
    this.remoteStream = null
    this.audioLevel = 0
    this.isMuted = false
    this.isPttActive = false
    this.onAudioLevelCbs.forEach((cb) => cb(0))
  }

  private setCallState(state: CallState) {
    console.log(`[VoiceCall] setState: ${this.callState} → ${state}, peer=${this.currentPeer?.name || 'null'}, cbCount=${this.onStateChangeCbs.size}`)
    this.callState = state

    // Permanently disable any auto-timeouts or auto-exit while a call is active
    if (state === 'active') {
      if (this.callTimeoutTimer) {
        clearTimeout(this.callTimeoutTimer)
        this.callTimeoutTimer = null
      }
      if (this.pageTimeoutTimer) {
        clearTimeout(this.pageTimeoutTimer)
        this.pageTimeoutTimer = null
      }
    }

    this.onStateChangeCbs.forEach((cb) => cb(state, this.currentPeer))
  }

  public onCallStateChange(cb: (state: CallState, peer: Peer | null) => void): () => void {
    this.onStateChangeCbs.add(cb)
    return () => this.onStateChangeCbs.delete(cb)
  }

  public onIncomingCall(cb: (signal: CallSignal, caller: Peer) => void): () => void {
    this.onIncomingCallCbs.add(cb)
    return () => this.onIncomingCallCbs.delete(cb)
  }

  public onIncomingPage(cb: (signal: CallSignal, caller: Peer) => void): () => void {
    this.onIncomingPageCbs.add(cb)
    return () => this.onIncomingPageCbs.delete(cb)
  }

  public onPageTimeout(cb: (peer: Peer, isInitiator: boolean) => void): () => void {
    this.onPageTimeoutCbs.add(cb)
    return () => this.onPageTimeoutCbs.delete(cb)
  }

  public onPageResponse(cb: (peer: Peer, type: 'accepted' | 'declined', note?: string) => void): () => void {
    this.onPageResponseCbs.add(cb)
    return () => this.onPageResponseCbs.delete(cb)
  }

  public onAudioLevel(cb: (level: number) => void): () => void {
    this.onAudioLevelCbs.add(cb)
    return () => this.onAudioLevelCbs.delete(cb)
  }

  public onCallWaiting(cb: (signal: CallSignal, caller: Peer) => void): () => void {
    this.onCallWaitingCbs.add(cb)
    return () => this.onCallWaitingCbs.delete(cb)
  }

  public onMultiCallChange(
    cb: (info: {
      activePeer: Peer | null
      heldPeer: Peer | null
      isConference: boolean
      isHeldByRemote: boolean
      sessions: CallSession[]
      waitingCall: { signal: CallSignal; caller: Peer } | null
    }) => void
  ): () => void {
    this.onMultiCallChangeCbs.add(cb)
    return () => this.onMultiCallChangeCbs.delete(cb)
  }
}

export const voiceCall = new VoiceCallManager()
