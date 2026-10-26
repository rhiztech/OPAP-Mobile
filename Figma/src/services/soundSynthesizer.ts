// Web Audio API Procedural Sound Synthesizer for OPAP P2P Intercom & Pager

class SoundSynthesizer {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private ringtoneInterval: number | null = null
  private ringbackInterval: number | null = null
  private isMuted: boolean = false
  private volume: number = 0.8 // 0.0 to 1.0

  constructor() {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('opap_volume_level')
        if (saved !== null) {
          const parsed = parseFloat(saved)
          if (!isNaN(parsed)) {
            this.volume = Math.max(0, Math.min(1, parsed / 100))
          }
        }
      }
    } catch {}
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (AudioCtx) {
          this.ctx = new AudioCtx()
          this.masterGain = this.ctx.createGain()
          this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime)
          this.masterGain.connect(this.ctx.destination)
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {})
      }
      return this.ctx
    } catch {
      return null
    }
  }

  public getDestination(): AudioNode {
    this.getContext()
    if (this.masterGain) return this.masterGain
    return this.ctx!.destination
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol))
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('opap_volume_level', String(Math.round(this.volume * 100)))
      }
    } catch {}

    const ctx = this.getContext()
    if (this.masterGain && ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, ctx.currentTime)
    }
  }

  public getVolume(): number {
    return this.volume
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted
    const ctx = this.getContext()
    if (this.masterGain && ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.volume, ctx.currentTime)
    }
  }

  public getMuted(): boolean {
    return this.isMuted
  }

  // 1. Tactile Mechanical Key Click
  public playKeyClick() {
    if (this.isMuted || this.volume <= 0) return
    try {
      const ctx = this.getContext()
      if (!ctx) return
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const filter = ctx.createBiquadFilter()

      filter.type = 'highpass'
      filter.frequency.value = 1200

      osc.type = 'triangle'
      osc.frequency.setValueAtTime(420, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.03)

      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03)

      osc.connect(filter)
      filter.connect(gain)
      gain.connect(this.getDestination())

      osc.start()
      osc.stop(ctx.currentTime + 0.035)
    } catch {}
  }

  // 2. DTMF Keypad Tones (1-9, *, #)
  public playDtmf(key: string) {
    if (this.isMuted) return
    try {
      const ctx = this.getContext()
      if (!ctx) return
      const dtmfFreqs: Record<string, [number, number]> = {
        '1': [697, 1209],
        '2': [697, 1336],
        '3': [697, 1477],
        '4': [770, 1209],
        '5': [770, 1336],
        '6': [770, 1477],
        '7': [852, 1209],
        '8': [852, 1336],
        '9': [852, 1477],
        '*': [941, 1209],
        '0': [941, 1336],
        '#': [941, 1477],
      }

      const freqs = dtmfFreqs[key] || [700, 1200]
      const duration = 0.09
      const now = ctx.currentTime

      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const gain = ctx.createGain()

      osc1.type = 'sine'
      osc1.frequency.setValueAtTime(freqs[0], now)

      osc2.type = 'sine'
      osc2.frequency.setValueAtTime(freqs[1], now)

      gain.gain.setValueAtTime(0.12, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration)

      osc1.connect(gain)
      osc2.connect(gain)
      gain.connect(this.getDestination())

      osc1.start(now)
      osc2.start(now)
      osc1.stop(now + duration)
      osc2.stop(now + duration)
    } catch {}
  }

  // 3. Incoming Call Ringtone (Retro Pager Chime)
  public startIncomingRingtone() {
    this.stopRingtone()
    if (this.isMuted) return

    const playChirp = () => {
      if (this.isMuted) return
      try {
        const ctx = this.getContext()
        if (!ctx) return
        const now = ctx.currentTime

        // 3-tone fast sequence
        const notes = [960, 1280, 1920]
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          const startTime = now + idx * 0.08

          osc.type = 'square'
          osc.frequency.setValueAtTime(freq, startTime)

          gain.gain.setValueAtTime(0.15, startTime)
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.07)

          osc.connect(gain)
          gain.connect(this.getDestination())

          osc.start(startTime)
          osc.stop(startTime + 0.075)
        })
      } catch {}
    }

    playChirp()
    if (typeof window !== 'undefined') {
      this.ringtoneInterval = window.setInterval(playChirp, 1800)
    }
  }

  public stopRingtone() {
    if (this.ringtoneInterval !== null) {
      clearInterval(this.ringtoneInterval)
      this.ringtoneInterval = null
    }
  }

  // 4. Outgoing Ringback Tone (Pulse)
  public startRingback() {
    this.stopRingback()
    if (this.isMuted) return

    const playPulse = () => {
      if (this.isMuted) return
      try {
        const ctx = this.getContext()
        if (!ctx) return
        const now = ctx.currentTime
        const duration = 0.8

        const osc1 = ctx.createOscillator()
        const osc2 = ctx.createOscillator()
        const gain = ctx.createGain()

        osc1.type = 'sine'
        osc1.frequency.setValueAtTime(440, now)

        osc2.type = 'sine'
        osc2.frequency.setValueAtTime(480, now)

        gain.gain.setValueAtTime(0.08, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration)

        osc1.connect(gain)
        osc2.connect(gain)
        gain.connect(this.getDestination())

        osc1.start(now)
        osc2.start(now)
        osc1.stop(now + duration)
        osc2.stop(now + duration)
      } catch {}
    }

    playPulse()
    if (typeof window !== 'undefined') {
      this.ringbackInterval = window.setInterval(playPulse, 2200)
    }
  }

  public stopRingback() {
    if (this.ringbackInterval !== null) {
      clearInterval(this.ringbackInterval)
      this.ringbackInterval = null
    }
  }

  // 5. PA Broadcast Announcement Chime (Ding-Dong Melody)
  public playPaChime() {
    if (this.isMuted) return
    try {
      const ctx = this.getContext()
      if (!ctx) return
      const now = ctx.currentTime

      const chimeNotes = [
        { freq: 587.33, delay: 0.0, dur: 0.35 },
        { freq: 880.0, delay: 0.28, dur: 0.55 },
      ]

      chimeNotes.forEach((n) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const startTime = now + n.delay

        osc.type = 'sine'
        osc.frequency.setValueAtTime(n.freq, startTime)

        gain.gain.setValueAtTime(0.22, startTime)
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + n.dur)

        osc.connect(gain)
        gain.connect(this.getDestination())

        osc.start(startTime)
        osc.stop(startTime + n.dur + 0.05)
      })
    } catch {}
  }

  public playBroadcastChime() {
    this.playPaChime()
  }

  // 6. Roger Beep / Walkie-Talkie Squelch
  public playRogerBeep() {
    if (this.isMuted) return
    try {
      const ctx = this.getContext()
      if (!ctx) return
      const now = ctx.currentTime

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'square'
      osc.frequency.setValueAtTime(1400, now)
      osc.frequency.setValueAtTime(2100, now + 0.05)

      gain.gain.setValueAtTime(0.12, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)

      osc.connect(gain)
      gain.connect(this.getDestination())

      osc.start(now)
      osc.stop(now + 0.13)
    } catch {}
  }

  // 7. Call Disconnect / End Tone
  public playDisconnectTone() {
    if (this.isMuted) return
    try {
      const ctx = this.getContext()
      if (!ctx) return
      const now = ctx.currentTime

      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const t = now + i * 0.12

        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(420, t)

        gain.gain.setValueAtTime(0.15, t)
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08)

        osc.connect(gain)
        gain.connect(this.getDestination())

        osc.start(t)
        osc.stop(t + 0.09)
      }
    } catch {}
  }

  // 8. Message Sent / Received Notification
  public playMessagePing(isIncoming: boolean = true) {
    if (this.isMuted) return
    try {
      const ctx = this.getContext()
      if (!ctx) return
      const now = ctx.currentTime

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      if (isIncoming) {
        osc.frequency.setValueAtTime(750, now)
        osc.frequency.exponentialRampToValueAtTime(1100, now + 0.1)
      } else {
        osc.frequency.setValueAtTime(1100, now)
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.08)
      }

      gain.gain.setValueAtTime(0.1, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)

      osc.connect(gain)
      gain.connect(this.getDestination())

      osc.start(now)
      osc.stop(now + 0.13)
    } catch {}
  }

  public playPagerChirp() {
    this.playMessagePing(true)
  }

  // 9. Urgent Pager Beep (Pulsing 3-tone retro pager alarm matching pre-set duration)
  private pagerBeepInterval: number | null = null
  private pagerBeepTimeout: number | null = null

  public startPagerBeep(durationSec: number | 'continuous' = 15) {
    this.stopPagerBeep()
    if (this.isMuted) return

    const playChirpTriple = () => {
      if (this.isMuted) return
      try {
        const ctx = this.getContext()
        if (!ctx) return
        const now = ctx.currentTime

        // Urgent fast high-pitch 3-chirp pager tone (2200Hz, 2750Hz, 3300Hz)
        const freqs = [2200, 2750, 3300]
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          const t = now + idx * 0.075

          osc.type = 'square'
          osc.frequency.setValueAtTime(freq, t)

          gain.gain.setValueAtTime(0.18, t)
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.065)

          osc.connect(gain)
          gain.connect(this.getDestination())

          osc.start(t)
          osc.stop(t + 0.07)
        })
      } catch {}
    }

    playChirpTriple()
    if (typeof window !== 'undefined') {
      this.pagerBeepInterval = window.setInterval(playChirpTriple, 1000)
      if (durationSec !== 'continuous') {
        const ms = typeof durationSec === 'number' ? durationSec * 1000 : 15000
        this.pagerBeepTimeout = window.setTimeout(() => {
          this.stopPagerBeep()
        }, ms)
      }
    }
  }

  public startPagerBeep15s() {
    this.startPagerBeep(15)
  }

  public stopPagerBeep() {
    if (this.pagerBeepInterval !== null) {
      clearInterval(this.pagerBeepInterval)
      this.pagerBeepInterval = null
    }
    if (this.pagerBeepTimeout !== null) {
      clearTimeout(this.pagerBeepTimeout)
      this.pagerBeepTimeout = null
    }
  }

  // GSM Call Waiting Tone: 425Hz pip-pip every 3.5 seconds
  private callWaitingInterval: number | null = null

  public startCallWaitingTone() {
    this.stopCallWaitingTone()
    if (this.isMuted || this.volume <= 0) return

    const playPipPair = () => {
      try {
        const ctx = this.getContext()
        if (!ctx) return
        const now = ctx.currentTime

        // Pip 1: 425Hz, 100ms
        const osc1 = ctx.createOscillator()
        const gain1 = ctx.createGain()
        osc1.type = 'sine'
        osc1.frequency.setValueAtTime(425, now)
        gain1.gain.setValueAtTime(0.12, now)
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.1)
        osc1.connect(gain1)
        gain1.connect(this.getDestination())
        osc1.start(now)
        osc1.stop(now + 0.1)

        // Pip 2: 425Hz, 100ms after 150ms gap
        const osc2 = ctx.createOscillator()
        const gain2 = ctx.createGain()
        osc2.type = 'sine'
        osc2.frequency.setValueAtTime(425, now + 0.15)
        gain2.gain.setValueAtTime(0.12, now + 0.15)
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
        osc2.connect(gain2)
        gain2.connect(this.getDestination())
        osc2.start(now + 0.15)
        osc2.stop(now + 0.25)
      } catch {}
    }

    playPipPair()
    if (typeof window !== 'undefined') {
      this.callWaitingInterval = window.setInterval(playPipPair, 3500)
    }
  }

  public stopCallWaitingTone() {
    if (this.callWaitingInterval !== null) {
      clearInterval(this.callWaitingInterval)
      this.callWaitingInterval = null
    }
  }

  // Stop all calling, ringing, call waiting, and pager loop tones
  public stopAllCallTones() {
    this.stopRingback()
    this.stopRingtone()
    this.stopCallWaitingTone()
    this.stopPagerBeep()
  }

  // GSM Call Hold Chime (520Hz -> 390Hz descending tone)
  public playHoldChime() {
    if (this.isMuted || this.volume <= 0) return
    try {
      const ctx = this.getContext()
      if (!ctx) return
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(520, now)
      osc.frequency.exponentialRampToValueAtTime(390, now + 0.22)
      gain.gain.setValueAtTime(0.15, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
      osc.connect(gain)
      gain.connect(this.getDestination())
      osc.start(now)
      osc.stop(now + 0.25)
    } catch {}
  }

  // GSM Call Resume Chime (390Hz -> 520Hz ascending tone)
  public playResumeChime() {
    if (this.isMuted || this.volume <= 0) return
    try {
      const ctx = this.getContext()
      if (!ctx) return
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(390, now)
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.22)
      gain.gain.setValueAtTime(0.15, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
      osc.connect(gain)
      gain.connect(this.getDestination())
      osc.start(now)
      osc.stop(now + 0.25)
    } catch {}
  }
}

export const sound = new SoundSynthesizer()
