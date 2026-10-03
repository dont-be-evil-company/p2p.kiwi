<script lang="ts">
  import { onMount } from 'svelte'
  import { L } from './translations'
  import { appState } from './appState.svelte'
  import { toast } from './toastState.svelte'
  import { sessionRoom as room } from './session/sessionStore.svelte'
  import { bonjourIncoming } from './bonjourIncoming.svelte'
  import {
    mergeIncomingCallSignal,
    shouldNotifyIncomingCall,
    type BonjourSignalPayload,
  } from './session/bonjourSignal'
  import { applyContactPresence, isPresenceStatus } from './bonjourPresence'
  import { debugLog } from './debugLog.svelte'
  import type { BonjourServerError } from './../../main/bonjour/types'
  import { BonjourServerErrorEnum } from '../../main/bonjour/enums'
  import { iceFailureText } from './session/connectionFailureText'
  import { recoverFailedConnection } from './session/recoverFailedConnection'
  import { inviteTokenInput, normalizeInviteToken } from './session/inviteToken'

  const CONTACTS_POLL_MS = 30_000

  const BonjourRequestProgressEnum = {
    'WAITING': 'waiting',
  } as const
  type BonjourRequestProgress = {
    requestState: typeof BonjourRequestProgressEnum[keyof typeof BonjourRequestProgressEnum]
  }
  let me = $state<{
    userId: string
    username: string | null
    acceptRequestsUntil: string | null
    acceptCallJoins: boolean
    image: string | null
  } | BonjourServerError | BonjourRequestProgress>({requestState: BonjourRequestProgressEnum.WAITING})
  let modalAddUserVisible = $state(false)
  let usernameDraft = $state('')
  let addUsername = $state('')
  // let listName = $state('')
  let contacts = $state<
    Array<{
      userId: string
      username: string
      devicePublicKey: string | null
      presence: 'available' | 'busy' | 'offline'
      acceptCallJoins: boolean
      image: string | null
    }>
  >([])
  let failedImages = $state<string[]>([])
  let incoming = $state<Array<{ id: string; fromUserId: string; username: string }>>([])
  let outgoing = $state<Array<{ id: string; toUserId: string; username: string }>>([])
  let ignored = $state<Array<{ userId: string; username: string }>>([])
  // let lists = $state<Array<{ id: string; name: string; memberIds: string[] }>>([])
  let invites = $state<Array<{ id: string; token: string; expiresAt: string }>>([])
  let inviteDraft = $state('')
  let sessionStarted = $state(false)
  let outgoingCallId: string | null = null
  let peerKeys = new Map<string, string>()
  let callPeers = new Map<string, { peerId: string; publicKey: string }>()
  let closedCalls = new Set<string>()
  let signalingFailed = false
  let lastPresence: 'available' | 'busy' | null = null
  let signalQueue: Promise<void> = Promise.resolve()
  let pendingSignals: Array<{
    callId?: string
    senderId?: string
    plain: BonjourSignalPayload
  }> = []

  const contactName = (userId: string): string =>
    contacts.find((contact) => contact.userId === userId)?.username ?? userId

  const contactImage = (userId: string): string | null =>
    contacts.find((contact) => contact.userId === userId)?.image ?? null

  const imageOk = (src: string | null | undefined): src is string =>
    Boolean(src) && !failedImages.includes(src)

  const markImageFailed = (src: string): void => {
    if (!failedImages.includes(src)) failedImages = [...failedImages, src]
  }

  const keyFor = (peerId: string | null | undefined): string | null => {
    if (!peerId) return null
    return (
      peerKeys.get(peerId) ??
      bonjourIncoming.call?.peerPublicKey ??
      contacts.find((contact) => contact.userId === peerId)?.devicePublicKey ??
      null
    )
  }

  const refresh = async (): Promise<void> => {
    me = await window.KiwiApi.bonjour.me()
    if (!me?.username) return
    contacts = await window.KiwiApi.bonjour.contacts()
    incoming = await window.KiwiApi.bonjour.incoming()
    outgoing = await window.KiwiApi.bonjour.outgoing()
    ignored = await window.KiwiApi.bonjour.ignored()
    // lists = await window.KiwiApi.bonjour.lists()
    peerKeys = new Map(
      contacts
        .filter((contact) => contact.devicePublicKey)
        .map((contact) => [contact.userId, contact.devicePublicKey as string]),
    )
  }

  const isClosedSignalError = (error: unknown): boolean => {
    if (!(error instanceof Error)) return false
    if (error.message === 'closed') return true
    return error.cause instanceof Error && error.cause.message === 'closed'
  }

  const sendSignal = (callId: string, payload: BonjourSignalPayload): void => {
    if (payload.type === 'hangup') closedCalls.add(callId)
    if (closedCalls.has(callId) && payload.type !== 'hangup') return
    const peer = callPeers.get(callId)
    const key = peer?.publicKey ?? keyFor(peer?.peerId)
    if (!callId || !key) {
      if (payload.type === 'offer' || payload.type === 'answer' || payload.type === 'mls-invite') {
        signalingFailed = true
        toast.show('error', 'contact has no encryption key yet; ask them to sign in again')
      }
      return
    }
    const post = async (): Promise<void> => {
      if (closedCalls.has(callId) && payload.type !== 'hangup') return
      await window.KiwiApi.bonjour.signal(callId, payload.type, key, payload)
    }
    if (payload.type === 'ice') {
      signalQueue = signalQueue.then(post).catch(() => undefined)
      return
    }
    if (signalingFailed) return
    signalQueue = signalQueue.then(post).catch((error) => {
      if (isClosedSignalError(error)) return
      if (signalingFailed) return
      signalingFailed = true
      toast.show('error', error instanceof Error ? error.message : L.bonjour_error())
    })
  }

  const registerCall = (callId: string, peerId: string, publicKey: string): void => {
    closedCalls.delete(callId)
    peerKeys.set(peerId, publicKey)
    callPeers.set(callId, { peerId, publicKey })
    room.bindBonjour(sendSignal)
  }

  const callIsReady = (callId?: string): boolean =>
    Boolean(callId && (callPeers.has(callId) || room.hasBonjourCall(callId)))

  const applyPlainSignal = (event: {
    callId?: string
    senderId?: string
    plain: BonjourSignalPayload
  }): void => {
    if (!event.callId) return
    if (event.senderId && !callPeers.has(event.callId)) {
      const key = keyFor(event.senderId)
      if (key) callPeers.set(event.callId, { peerId: event.senderId, publicKey: key })
    }
    void room.applyBonjourSignal(event.callId, event.plain).catch((error) => {
      toast.show('error', error instanceof Error ? error.message : L.bonjour_error())
    })
  }

  const flushPendingSignals = (): void => {
    const queued = pendingSignals
    pendingSignals = []
    for (const event of queued) {
      if (callIsReady(event.callId)) applyPlainSignal(event)
      else if (event.plain.type !== 'hangup') pendingSignals.push(event)
    }
  }

  const maybeResetAfterCallClosed = (): void => {
    if (appState.sessionSource !== 'bonjour') return
    if (room.isLive || room.sessionEndedReason) return
    if (callPeers.size > 0 || room.bonjourCallId) return
    if (sessionStarted) reset()
  }

  const closeCall = (callId: string): void => {
    callPeers.delete(callId)
    closedCalls.add(callId)
    pendingSignals = pendingSignals.filter((item) => item.callId !== callId)
    void room.dropBonjourCall(callId).then(() => maybeResetAfterCallClosed())
  }

  const inviteErrorText = (error: unknown): string => {
    const message = error instanceof Error ? error.message : ''
    switch (message) {
      case 'rate limited':
        return L.bonjour_invite_rate_limited()
      case 'invalid':
        return L.bonjour_invite_invalid()
      case 'expired':
        return L.bonjour_invite_expired()
      case 'used':
        return L.bonjour_invite_used()
      case 'revoked':
        return L.bonjour_invite_revoked()
      case 'own-token':
        return L.bonjour_invite_own()
      case 'offline':
        return L.bonjour_invite_offline()
      case 'no-device-key':
      case 'invite desk required':
      case 'bonjour invites are not ready':
        return L.bonjour_invite_not_ready()
      case 'room is full':
        return L.bonjour_invite_full()
      default:
        return message || L.bonjour_error()
    }
  }

  const refreshInvites = async (): Promise<void> => {
    try {
      invites = await window.KiwiApi.bonjour.listInvites()
    } catch {
      // The desk is still opening, or Bonjour is unreachable.
    }
  }

  const canHostInvite = (): boolean => {
    if (!sessionStarted && !room.isLive) return true
    return room.isLive && room.isCoordinator && appState.sessionSource === 'bonjour'
  }

  const onCreateInvite = async (): Promise<void> => {
    try {
      await window.KiwiApi.bonjour.createInvite()
      await refreshInvites()
    } catch (error) {
      toast.show('error', inviteErrorText(error))
    }
  }

  const onCopyInvite = async (token: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(token)
      toast.show('success', L.bonjour_invite_copied())
    } catch (error) {
      toast.show('error', inviteErrorText(error))
    }
  }

  const onRevokeInvite = async (id: string): Promise<void> => {
    try {
      await window.KiwiApi.bonjour.revokeInvite(id)
      await refreshInvites()
    } catch (error) {
      toast.show('error', inviteErrorText(error))
    }
  }

  const onInviteRedeemed = async (event: {
    callId: string
    peerId: string
    devicePublicKey: string
    username: string | null
  }): Promise<void> => {
    await window.KiwiApi.bonjour.trackInviteCall(event.callId)
    void refreshInvites()
    if (!canHostInvite()) {
      await window.KiwiApi.bonjour.hangup(event.callId).catch(() => undefined)
      toast.show('error', L.bonjour_invite_unavailable())
      return
    }
    let started = false
    try {
      signalingFailed = false
      if (!room.isLive && !sessionStarted) {
        const setup = await room.Setup(null, { captureDisplay: false })
        if (setup !== 'ok') {
          toast.show('error', L.connection_failed())
          await window.KiwiApi.bonjour.hangup(event.callId).catch(() => undefined)
          return
        }
        sessionStarted = true
        started = true
        appState.isHosting = true
        appState.isCoordinator = true
        appState.navigationEnabled = false
        appState.beginSession('bonjour', reset)
      }
      registerCall(event.callId, event.peerId, event.devicePublicKey)
      await room.startBonjourCall({ callId: event.callId, peerId: event.peerId })
      flushPendingSignals()
    } catch (error) {
      toast.show('error', inviteErrorText(error))
      await window.KiwiApi.bonjour.hangup(event.callId).catch(() => undefined)
      if (callPeers.has(event.callId) || room.hasBonjourCall(event.callId)) closeCall(event.callId)
      if (started && !room.isLive) {
        await room.Disconnect()
        reset()
      }
    }
  }

  const onRedeemInvite = async (): Promise<void> => {
    const token = normalizeInviteToken(inviteDraft)
    if (!token) {
      toast.show('error', L.bonjour_invite_invalid())
      return
    }
    if (sessionStarted || room.isLive) {
      toast.show('error', L.bonjour_invite_busy())
      return
    }
    try {
      signalingFailed = false
      const redeemed = await window.KiwiApi.bonjour.redeemInvite(token)
      inviteDraft = ''
      const setup = await room.Setup(document.createElement('video'))
      if (setup !== 'ok') {
        await window.KiwiApi.bonjour.hangup(redeemed.callId).catch(() => undefined)
        toast.show('error', L.connection_failed())
        return
      }
      appState.isWatching = true
      appState.navigationEnabled = false
      sessionStarted = true
      appState.beginSession('bonjour', reset)
      registerCall(redeemed.callId, redeemed.peer.userId, redeemed.peer.devicePublicKey)
      await room.requestBonjourJoin({ callId: redeemed.callId, peerId: redeemed.peer.userId })
      flushPendingSignals()
    } catch (error) {
      toast.show('error', inviteErrorText(error))
      if (sessionStarted && !room.isLive && appState.sessionSource === 'bonjour') {
        await room.Disconnect()
        reset()
      }
    }
  }

  onMount(() => {
    bonjourIncoming.accept = (): void => {
      void onAcceptCall()
    }
    bonjourIncoming.reject = (): void => {
      const call = bonjourIncoming.call
      if (call) void window.KiwiApi.bonjour.rejectCall(call.callId)
      bonjourIncoming.call = null
      bonjourIncoming.callerName = ''
      bonjourIncoming.callerImage = null
    }
    room.bindBonjour(sendSignal)
    window.KiwiApi.bonjour.onAuth((payload) => {
      me = (payload as typeof me) ?? null
      void refresh()
    })
    window.KiwiApi.bonjour.onEvent((raw) => {
      const event = raw as {
        type: string
        callId?: string
        fromUserId?: string
        userId?: string
        status?: string
        kind?: string
        senderId?: string
        peerId?: string
        username?: string | null
        signalType?: string
        devicePublicKey?: string | null
        ciphertextOmitted?: boolean
        plain?: BonjourSignalPayload | null
      }
      if (event.type === 'hangup' && event.callId) {
        if (callPeers.has(event.callId) || room.hasBonjourCall(event.callId)) closeCall(event.callId)
        else maybeResetAfterCallClosed()
      }
      if (
        event.type === 'invite-redeemed' &&
        event.callId &&
        event.peerId &&
        event.devicePublicKey
      ) {
        void onInviteRedeemed({
          callId: event.callId,
          peerId: event.peerId,
          devicePublicKey: event.devicePublicKey,
          username: typeof event.username === 'string' ? event.username : null,
        })
      }
      if (event.type === 'incoming-call' && event.callId && event.fromUserId) {
        const kind = String(event.kind ?? 'start')
        if (!shouldNotifyIncomingCall({ inSession: sessionStarted || room.isLive, kind })) return
        if (bonjourIncoming.call?.callId === event.callId) return
        const peerPublicKey =
          (typeof event.devicePublicKey === 'string' && event.devicePublicKey) ||
          peerKeys.get(event.fromUserId) ||
          null
        if (peerPublicKey) peerKeys.set(event.fromUserId, peerPublicKey)
        bonjourIncoming.call = {
          callId: event.callId,
          fromUserId: event.fromUserId,
          kind,
          peerPublicKey,
        }
        bonjourIncoming.callerName = contactName(event.fromUserId)
        bonjourIncoming.callerImage = contactImage(event.fromUserId)
      }
      if (event.type === 'signal' && !event.plain && event.signalType && event.signalType !== 'ice') {
        toast.show('error', L.bonjour_error())
      }
      if (event.type === 'signal' && event.plain) {
        if (bonjourIncoming.call) {
          bonjourIncoming.call = mergeIncomingCallSignal(bonjourIncoming.call, event)
        }
        if (event.plain.type === 'hangup') {
          if (!event.callId || bonjourIncoming.call?.callId === event.callId) {
            bonjourIncoming.call = null
            bonjourIncoming.callerName = ''
            bonjourIncoming.callerImage = null
          }
          if (event.callId && (callPeers.has(event.callId) || room.hasBonjourCall(event.callId))) {
            closeCall(event.callId)
          } else {
            maybeResetAfterCallClosed()
          }
          return
        }
        if (!callIsReady(event.callId)) {
          pendingSignals.push({
            callId: event.callId,
            senderId: event.senderId,
            plain: event.plain,
          })
          return
        }
        applyPlainSignal({
          callId: event.callId,
          senderId: event.senderId,
          plain: event.plain,
        })
      }
      if (event.type === 'call-accepted' && event.callId && callPeers.has(event.callId)) {
        void refresh()
      }
      if (event.type === 'call-rejected' && event.callId) {
        if (callPeers.has(event.callId) || room.hasBonjourCall(event.callId)) closeCall(event.callId)
        else maybeResetAfterCallClosed()
      }
      if (event.type === 'contact-request' || event.type === 'contact-accepted') {
        void refresh()
      }
      if (event.type === 'presence') {
        if (!event.userId || (me && 'error' in me === false && 'requestState' in me === false && event.userId === me.userId)) return
        if (!isPresenceStatus(event.status)) {
          debugLog.warn('bonjour', 'presence event missing status', { userId: event.userId })
          void refresh()
          return
        }
        debugLog.info('bonjour', 'presence event', { userId: event.userId, status: event.status })
        const next = applyContactPresence(contacts, event.userId, event.status)
        if (next !== contacts) {
          contacts = next
          return
        }
        void refresh()
      }
    })
    void refresh()
    void refreshInvites()
    const poll = setInterval(() => {
      void refreshInvites()
      if ('error' in me === false && 'requestState' in me === false && !me?.username) return
      void refresh()
    }, CONTACTS_POLL_MS)
    return (): void => {
      clearInterval(poll)
      bonjourIncoming.call = null
      bonjourIncoming.callerName = ''
      bonjourIncoming.callerImage = null
      bonjourIncoming.accept = (): void => {}
      bonjourIncoming.reject = (): void => {}
      void window.KiwiApi.bonjour.setPresence('offline')
    }
  })

  $effect(() => {
    const busy = room.isLive || sessionStarted || appState.isHosting || appState.isWatching
    const next = busy ? 'busy' : 'available'
    if (next === lastPresence) return
    lastPresence = next
    void window.KiwiApi.bonjour.setPresence(next)
  })

  $effect(() => {
    const call = bonjourIncoming.call
    if (!call) return
    bonjourIncoming.callerName = contactName(call.fromUserId)
    bonjourIncoming.callerImage = contactImage(call.fromUserId)
  })

  $effect(() => {
    if (appState.sessionSource !== 'bonjour') return
    switch (room.connectionState) {
      case 'connected':
        toast.show('success', L.connection_established())
        break
      case 'failed':
        toast.show('error', iceFailureText(room.connectionFailure))
        recoverFailedConnection()
        break
      default:
        break
    }
  })

  const onLogin = (): void => {
    void window.KiwiApi.bonjour.login()
  }

  const onClaim = async (): Promise<void> => {
    try {
      await window.KiwiApi.bonjour.claimUsername(usernameDraft)
      await refresh()
    } catch (error) {
      toast.show('error', error instanceof Error ? error.message : L.bonjour_error())
    }
  }

  const onAdd = async (): Promise<void> => {
    try {
      await window.KiwiApi.bonjour.request(addUsername)
      addUsername = ''
      await refresh()
      modalAddUserVisible = false
    } catch (error) {
      toast.show('error', error instanceof Error ? error.message : L.bonjour_error())
    }
  }

  const onCall = async (contact: (typeof contacts)[0], kind: 'start' | 'join'): Promise<void> => {
    let startedId: string | null = null
    try {
      if (!contact.devicePublicKey) {
        throw new Error('contact has no encryption key yet; ask them to sign in again')
      }
      signalingFailed = false
      if (kind === 'start' && !room.isLive && !sessionStarted) {
        const setup = await room.Setup(null, { captureDisplay: false })
        if (setup !== 'ok') {
          toast.show('error', L.connection_failed())
          return
        }
        sessionStarted = true
        appState.isHosting = true
        appState.isCoordinator = true
        appState.navigationEnabled = false
        appState.beginSession('bonjour', reset)
      }
      if (kind === 'join' && !room.isLive) {
        const setup = await room.Setup(document.createElement('video'))
        if (setup !== 'ok') {
          toast.show('error', L.connection_failed())
          return
        }
        appState.isWatching = true
        appState.navigationEnabled = false
        sessionStarted = true
        appState.beginSession('bonjour', reset)
      }
      const started = await window.KiwiApi.bonjour.startCall(contact.userId, kind)
      startedId = started.callId
      outgoingCallId = started.callId
      registerCall(started.callId, contact.userId, contact.devicePublicKey)
      if (kind === 'start') {
        await room.startBonjourCall({ callId: started.callId, peerId: contact.userId })
        flushPendingSignals()
        return
      }
      await room.requestBonjourJoin({ callId: started.callId, peerId: contact.userId })
      flushPendingSignals()
    } catch (error) {
      toast.show('error', error instanceof Error ? error.message : L.bonjour_error())
      if (startedId && (callPeers.has(startedId) || room.hasBonjourCall(startedId))) {
        void window.KiwiApi.bonjour.hangup(startedId).catch(() => undefined)
        closeCall(startedId)
      }
      if (sessionStarted && !room.isLive && appState.sessionSource === 'bonjour') {
        await room.Disconnect()
        reset()
      }
    }
  }

  const onAcceptCall = async (): Promise<void> => {
    if (!bonjourIncoming.call) return
    const call = bonjourIncoming.call
    bonjourIncoming.call = null
    bonjourIncoming.callerName = ''
    bonjourIncoming.callerImage = null
    try {
      signalingFailed = false
      let key = call.peerPublicKey ?? keyFor(call.fromUserId)
      if (!key) {
        await refresh()
        key = keyFor(call.fromUserId)
      }
      if (!key) {
        throw new Error('contact has no encryption key yet; ask them to sign in again')
      }
      await window.KiwiApi.bonjour.acceptCall(call.callId)
      registerCall(call.callId, call.fromUserId, key)
      if (room.isLive || (call.kind === 'join' && appState.isHosting)) {
        await room.startBonjourCall({ callId: call.callId, peerId: call.fromUserId })
        flushPendingSignals()
        return
      }
      const setup = await room.Setup(document.createElement('video'))
      if (setup !== 'ok') {
        void window.KiwiApi.bonjour.hangup(call.callId).catch(() => undefined)
        closeCall(call.callId)
        return
      }
      appState.isWatching = true
      appState.navigationEnabled = false
      sessionStarted = true
      appState.beginSession('bonjour', reset)
      if (call.offer) {
        await room.acceptBonjourCall({
          callId: call.callId,
          peerId: call.fromUserId,
          offer: call.offer,
          invite: call.invite,
        })
      } else {
        await room.requestBonjourJoin({ callId: call.callId, peerId: call.fromUserId })
      }
      flushPendingSignals()
    } catch (error) {
      toast.show('error', error instanceof Error ? error.message : L.bonjour_error())
      if (room.isLive && (callPeers.has(call.callId) || room.hasBonjourCall(call.callId))) {
        void window.KiwiApi.bonjour.hangup(call.callId).catch(() => undefined)
        closeCall(call.callId)
        return
      }
      if (sessionStarted && !room.isLive) {
        await room.Disconnect()
        reset()
      }
    }
  }

  const reset = (): void => {
    sessionStarted = false
    signalingFailed = false
    bonjourIncoming.call = null
    bonjourIncoming.callerName = ''
    bonjourIncoming.callerImage = null
    pendingSignals = []
    outgoingCallId = null
    callPeers.clear()
    closedCalls.clear()
    lastPresence = null
    appState.navigationEnabled = true
    appState.isHosting = false
    appState.isWatching = false
    appState.isCoordinator = false
    appState.clearSession()
    void window.KiwiApi.bonjour.setPresence('available')
  }

  const onDisconnectClick = async (): Promise<void> => {
    const ids = new Set<string>(callPeers.keys())
    if (outgoingCallId) ids.add(outgoingCallId)
    for (const id of ids) void window.KiwiApi.bonjour.hangup(id).catch(() => undefined)
    await room.Disconnect()
    reset()
  }

  // const addMember = async (listId: string, peerId: string): Promise<void> => {
  //   if (!peerId) return
  //   await window.KiwiApi.bonjour.addListMember(listId, peerId)
  //   await refresh()
  // }
</script>

{#snippet invitePanel()}
  <section class="mt-6 mb-6 max-w-md">
    <h2 class="text-xl font-semibold mb-2">{L.bonjour_invites()}</h2>
    <p class="mb-3 text-sm opacity-80">{L.bonjour_invites_description()}</p>
    <button class="btn btn-accent mb-3" onclick={() => void onCreateInvite()}>{L.bonjour_invite_create()}</button>
    {#if invites.length}
      <ul class="list bg-base-100 rounded-box shadow-md mb-4">
        {#each invites as invite (invite.id)}
          <li class="list-row flex-wrap gap-1 items-center">
            <span class="font-mono tracking-widest bonjour-menu-entry-noop">{invite.token}</span>
            <span class="text-sm opacity-70 bonjour-menu-entry-noop">{L.bonjour_invite_expires()} {new Date(invite.expiresAt).toLocaleTimeString()}</span>
            <button class="btn btn-sm hover:btn-success" onclick={() => void onCopyInvite(invite.token)}>{L.bonjour_invite_copy()}</button>
            <button class="btn btn-sm btn-ghost hover:btn-error" onclick={() => void onRevokeInvite(invite.id)}>{L.bonjour_invite_revoke()}</button>
          </li>
        {/each}
      </ul>
    {/if}
    <form class="join" onsubmit={(event) => { event.preventDefault(); void onRedeemInvite() }}>
      <input
        class="input join-item font-mono uppercase tracking-widest"
        maxlength="8"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        value={inviteDraft}
        oninput={(event) => {
          inviteDraft = inviteTokenInput(event.currentTarget.value)
        }}
        placeholder={L.bonjour_invite_code()}
      />
      <button class="btn btn-primary join-item" type="submit">{L.bonjour_invite_join()}</button>
    </form>
  </section>
{/snippet}

<h1 class="text-3xl font-bold mb-4">{L.bonjour()}</h1>

{#if sessionStarted && !room.isLive && !room.sessionEndedReason}
  <div class="flex flex-wrap gap-2 mb-4">
    <button class="btn btn-primary" disabled>
      <span class="loading loading-spinner"></span>
      <span>{L.session_started()}</span>
    </button>
    <button class="btn btn-error" onclick={onDisconnectClick}>
      <span class="icon">
        <i class="fas fa-unlink"></i>
      </span>
      <span>{L.cancel()}</span>
    </button>
  </div>
{/if}

{#if !sessionStarted || room.isLive || room.sessionEndedReason}
{#if !me || ('error' in me === true && me.error === BonjourServerErrorEnum.SERVER_UNAUTHORIZED)}
  <p class="mb-4">{L.bonjour_sign_in_description()}</p>
  <button class="btn btn-primary" onclick={onLogin}>{L.bonjour_sign_in()}</button>
  {@render invitePanel()}
{:else if 'error' in me === false && 'requestState' in me === false && !me.username}
  <p class="mb-4">{L.bonjour_choose_username()}</p>
  <div class="join mb-4">
    <input class="input join-item" bind:value={usernameDraft} placeholder={L.username()} />
    <button class="btn btn-primary join-item" onclick={onClaim}>{L.save()}</button>
  </div>
  {@render invitePanel()}
{:else if 'error' in me === true}
  <div role="alert" class="alert alert-error text-xl">
    <i class="fa-solid fa-triangle-exclamation"></i>
    <span>{me.error}</span>
  </div>
  {@render invitePanel()}
{:else if 'requestState' in me === true}
  <div class="text-center">
    <span class="loading loading-spinner loading-xl text-info"></span>
  </div>
{:else}
  <div class="grid grid-cols-[auto_1fr] gap-4 mb-4 items-center">
    <div class="avatar avatar-online {imageOk(me.image) ? '' : 'avatar-placeholder'}">
      <div class="bg-neutral text-neutral-content w-24 rounded-full">
        {#if imageOk(me.image)}
          {@const src = me.image}
          <img src={src} alt="" onerror={() => markImageFailed(src)} />
        {:else}
          <i class="fa-solid fa-user text-3xl"></i>
        {/if}
      </div>
    </div>
    <div>
      <h1 class="text-xl text-accent">
        <span class="tooltip" data-tip={L.username()}>
          {me.username}
        </span>
      </h1>
      <button class="btn btn-sm btn-soft hover:btn-warning" onclick={() => window.KiwiApi.bonjour.logout()}>{L.bonjour_sign_out()}</button>
    </div>
  </div>
  {#if incoming.length}
    <h2 class="text-xl font-semibold mb-2">{L.bonjour_incoming()}</h2>
    {#each incoming as req (req.id)}
      <div class="flex gap-2 mb-2 items-center">
        <span>{req.username}</span>
        <button class="btn btn-sm btn-success" onclick={() => window.KiwiApi.bonjour.respond(req.id, 'accept').then(refresh)}>{L.approve()}</button>
        <button class="btn btn-sm" onclick={() => window.KiwiApi.bonjour.respond(req.id, 'decline').then(refresh)}>{L.deny()}</button>
        <button class="btn btn-sm btn-ghost" onclick={() => window.KiwiApi.bonjour.ignore(req.id).then(refresh)}>{L.bonjour_ignore()}</button>
      </div>
    {/each}
  {/if}

  {#if outgoing.length}
    <h2 class="text-xl font-semibold mb-2">{L.bonjour_outgoing()}</h2>
    {#each outgoing as req (req.id)}
      <div class="flex gap-2 mb-2 items-center">
        <span>{req.username}</span>
        <button class="btn btn-sm" onclick={() => window.KiwiApi.bonjour.retract(req.id).then(refresh)}>{L.cancel()}</button>
      </div>
    {/each}
  {/if}
    {@render invitePanel()}
    <h2 class="text-3xl">{L.bonjour_contacts()}</h2>
    <div class="bg-base-200 max-w-max rounded-box">
        <ul class="menu menu-horizontal">
          <!-- <li> -->
          <!--   <button -->
          <!--     class="btn btn-ghost btn-circle hover:text-info" -->
          <!--     aria-label={L.bonjour_lists()} -->
          <!--     onclick={()=>modalAddUserVisible=!modalAddUserVisible}> -->
          <!--     <span class="tooltip" data-tip={L.bonjour_lists()}> -->
          <!--       <i class=" fa-solid fa-address-book text-xl"></i> -->
          <!--     </span> -->
          <!--   </button> -->
          <!-- </li> -->
          <li>
            <button
              class="btn btn-ghost btn-circle hover:text-info"
                aria-label={L.bonjour_add_contact()}
                onclick={()=>modalAddUserVisible=!modalAddUserVisible}>
              <span class="tooltip" data-tip={L.bonjour_add_contact()}>
                <i class=" fa-solid fa-user-plus text-xl"></i>
              </span>
            </button>
          </li>
          <li>
            <button
              class="btn btn-ghost btn-circle"
                aria-label={L.bonjour_add_contact()}
                data-active={Boolean(me.acceptRequestsUntil && Date.parse(me.acceptRequestsUntil) > Date.now()) ? '1' : '0'}
                onclick={(event)=>{
                  const newState = event.currentTarget.dataset.active === '1' ? false : true
                  event.currentTarget.dataset.active = newState ? '1' : '0'
                  void window.KiwiApi.bonjour.setAcceptRequests(newState).then(() => refresh())
                }}>
              <span class="tooltip" data-tip={L.bonjour_accept_requests() + (me.acceptRequestsUntil && Date.parse(me.acceptRequestsUntil) > Date.now() ? ` until ${new Date(me.acceptRequestsUntil).toLocaleString()}` : '')}>
                <i class="fa-solid fa-user-group text-xl {me.acceptRequestsUntil && Date.parse(me.acceptRequestsUntil) > Date.now() ? 'text-warning' : ''}"></i>
              </span>
            </button>
          </li>
          <li>
            <button
              class="btn btn-ghost btn-circle"
                aria-label={L.bonjour_add_contact()}
                data-active={me.acceptCallJoins ? '1' : '0'}
                onclick={(event)=>{
                  const newState = event.currentTarget.dataset.active === '1' ? false : true
                  event.currentTarget.dataset.active = newState ? '1' : '0'
                  void window.KiwiApi.bonjour.setAcceptCallJoins(newState).then(() => refresh())
                }}>
              <span class="tooltip" data-tip={L.bonjour_accept_call_joins() + (me.acceptRequestsUntil && Date.parse(me.acceptRequestsUntil) > Date.now() ? ` until ${new Date(me.acceptRequestsUntil).toLocaleString()}` : '')}>
                <i class="fa-solid fa-bell text-xl {me.acceptCallJoins ? 'text-warning' : ''}"></i>
              </span>
            </button>
            </li>
          </ul>
      </div>

    <dialog class="modal{modalAddUserVisible ? ' modal-open' : ''}">
      <div class="modal-box">
        <form method="dialog">
          <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" onclick={()=>modalAddUserVisible=!modalAddUserVisible}>✕</button>
        </form>
        <h2 class="text-xl font-semibold mb-2">{L.bonjour_add_contact()}</h2>
        <div class="join mb-4">
          <form class="form join" onsubmit={(event) => { event.preventDefault(); onAdd(); }}>
            <input class="input join-item" bind:value={addUsername} placeholder={L.username()} />
            <button class="btn btn-accent join-item">{L.bonjour_send_request()}</button>
          </form>
        </div>
      </div>
    </dialog>

    <ul class="list bg-base-100 rounded-box shadow-md max-w-max">
      {#each contacts as contact (contact.userId)}
      <li class="list-row grid gap-2 items-center {contact.presence === 'offline' ? 'opacity-30' : ''}">
        <div class="bonjour-menu-entry-noop">
          <span class="tooltip" data-tip={contact.presence}>
            <div class="grid grid-cols-[auto_1fr] gap-4 items-center">
              <div class="avatar {imageOk(contact.image) ? '' : 'avatar-placeholder'} {contact.presence === 'available' ? 'avatar-online' : 'avatar-offline'} {contact.presence === 'available' ? 'text-success' : contact.presence === 'busy' ? 'text-warning' : 'text-error'}">
                <div class="w-10 rounded-full">
                  {#if imageOk(contact.image)}
                    {@const src = contact.image}
                    <img src={src} alt="" onerror={() => markImageFailed(src)} />
                  {:else}
                    <i class="fa-solid fa-user"></i>
                  {/if}
                </div>
              </div>
            </div>
          </span>
        </div>
        <div class="bonjour-menu-entry-noop">
          <div>{contact.username}</div>
        </div>
        {#if contact.presence === 'available' && room.isLive && room.isCoordinator}
          <button
            class="btn btn-square btn-ghost hover:btn-success"
            aria-label={L.bonjour_add_to_call()}
            title={L.bonjour_add_to_call()}
            onclick={() => onCall(contact, 'start')}
          >
            <i class="fas fa-user-plus"></i>
          </button>
        {:else if contact.presence === 'available'}
          <button
            class="btn btn-square btn-ghost hover:btn-success"
            aria-label={L.bonjour_call()}
            disabled={sessionStarted || room.isLive}
            onclick={() => onCall(contact, 'start')}
          >
            <i class="fas fa-phone"></i>
          </button>
        {/if}
        {#if contact.presence === 'busy' && contact.acceptCallJoins}
          <button class="btn btn-sm" disabled={sessionStarted || room.isLive} onclick={() => onCall(contact, 'join')}>{L.bonjour_ask_to_join()}</button>
        {/if}
        <button class="btn btn-square btn-ghost hover:btn-error" aria-label={L.bonjour_remove()} onclick={() => {
          const reply = window.confirm(`${L.bonjour_remove()} ${contact.username}?`);
          if (!reply) return;
          window.KiwiApi.bonjour.removeContact(contact.userId).then(refresh);}
        }>
          <i class="fa-solid fa-user-minus"></i>
        </button>
      </li>
    {/each}
  </ul>
<!--
  <h2 class="text-xl font-semibold mt-4 mb-2">{L.bonjour_lists()}</h2>
  <div class="join mb-4">
    <input class="input join-item" bind:value={listName} />
    <button
      class="btn join-item"
      onclick={() => window.KiwiApi.bonjour.createList(listName).then(() => { listName = ''; return refresh() })}
    >{L.bonjour_create_list()}</button>
  </div>
  {#each lists as list (list.id)}
    <div class="mb-3">
      <div class="flex gap-2 items-center mb-1">
        <strong>{list.name}</strong>
        <button class="btn btn-xs btn-ghost" onclick={() => window.KiwiApi.bonjour.deleteList(list.id).then(refresh)}>{L.bonjour_delete_list()}</button>
      </div>
      <div class="flex flex-wrap gap-2 mb-1">
        {#each list.memberIds as memberId (memberId)}
          <span class="badge gap-1">
            {contactName(memberId)}
            <button
              class="btn btn-ghost btn-xs"
              onclick={() => window.KiwiApi.bonjour.removeListMember(list.id, memberId).then(refresh)}
            >×</button>
          </span>
        {/each}
      </div>
      <select
        class="select select-sm select-bordered"
        onchange={(event) => {
          const peerId = event.currentTarget.value
          event.currentTarget.value = ''
          void addMember(list.id, peerId)
        }}
      >
        <option value="">{L.bonjour_add_contact()}</option>
        {#each contacts.filter((contact) => !list.memberIds.includes(contact.userId)) as contact (contact.userId)}
          <option value={contact.userId}>{contact.username}</option>
        {/each}
      </select>
    </div>
  {/each}
-->

  {#if ignored.length}
    <h2 class="text-xl font-semibold mt-4 mb-2">{L.bonjour_ignored()}</h2>
    {#each ignored as row (row.userId)}
      <div class="flex gap-2 mb-2 items-center">
        <span>{row.username}</span>
        <button class="btn btn-sm" onclick={() => window.KiwiApi.bonjour.unignore(row.userId).then(refresh)}>{L.bonjour_unignore()}</button>
      </div>
    {/each}
  {/if}
{/if}
{/if}

<style>
.bonjour-menu-entry-noop:hover {
  background: none;
  user-select: none;
  cursor: default;
}
</style>
