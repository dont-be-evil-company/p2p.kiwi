import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, safeStorage, shell } from 'electron'
import { loadOrCreateIdentity } from '../identityStore'
import { decryptEnvelope, encryptEnvelope, encryptionPublicKey } from './envelope'
import { TrpcHttp } from './trpc'
import type {
  BonjourContact,
  BonjourEvent,
  BonjourList,
  BonjourMe,
  BonjourServerError,
  BonjourRequest,
  CallKind,
  PlainSignal,
  PresenceStatus,
  SignalType,
} from './types'
import { startAuthLoopback } from './loopback'
import { eventsWsUrl, tokenFromBonjourAuthUrl } from './urls'
import { BonjourServerErrorEnum } from './enums'

const EVENTS_RECONNECT_MS = 2_000

const tokenPath = (): string => join(app.getPath('userData'), 'bonjour-session.bin')
const deskPath = (): string => join(app.getPath('userData'), 'bonjour-invite-desk.bin')

type InviteCode = { id: string; token: string; expiresAt: string }
type InviteRedeemResult = {
  callId: string
  expiresAt: string
  peer: { userId: string; username: string | null; devicePublicKey: string }
}

const persistToken = async (token: string | null): Promise<void> => {
  await writePacked(tokenPath(), token)
}

const persistDesk = async (secret: string | null): Promise<void> => {
  await writePacked(deskPath(), secret)
}

const readPacked = async (file: string): Promise<string | null> => {
  if (!existsSync(file)) return null
  const packed = readFileSync(file)
  if (!packed.length) return null
  try {
    return (await safeStorage.isAsyncEncryptionAvailable())
      ? (await safeStorage.decryptStringAsync(packed)).result
      : packed.toString('utf8')
  } catch {
    return null
  }
}

const writePacked = async (file: string, value: string | null): Promise<void> => {
  mkdirSync(app.getPath('userData'), { recursive: true })
  if (!value) {
    writeFileSync(file, Buffer.alloc(0), { mode: 0o600 })
    return
  }
  const stored = (await safeStorage.isAsyncEncryptionAvailable())
    ? await safeStorage.encryptStringAsync(value)
    : Buffer.from(value, 'utf8')
  writeFileSync(file, stored, { mode: 0o600 })
}

const readToken = async (): Promise<string | null> => readPacked(tokenPath())
const readDesk = async (): Promise<string | null> => readPacked(deskPath())

export class BonjourClient {
  private token: string | null = null
  private deskSecret: string | null = null
  private inviteCallIds = new Set<string>()
  private deskChain: Promise<void> = Promise.resolve()
  private http: TrpcHttp | null = null
  private ws: WebSocket | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private eventsReconnect: ReturnType<typeof setTimeout> | null = null
  private eventsGeneration = 0
  private window: BrowserWindow | null = null
  private serverUrl = ''
  presence: PresenceStatus = 'offline'

  attachWindow(win: BrowserWindow): void {
    this.window = win
    if ((this.token || this.deskSecret) && this.serverUrl) this.openEvents()
  }

  private liveWindow(): BrowserWindow | null {
    if (this.window && !this.window.isDestroyed()) return this.window
    return BrowserWindow.getAllWindows().find((open) => !open.isDestroyed()) ?? null
  }

  emit(channel: string, payload: unknown): void {
    const win = this.liveWindow()
    if (!win || win.webContents.isDestroyed()) return
    win.webContents.send(channel, payload)
  }

  async configured(serverUrl: string): Promise<void> {
    const next = serverUrl.replace(/\/$/, '')
    const changed = Boolean(this.serverUrl) && this.serverUrl !== next
    this.serverUrl = next
    this.http = new TrpcHttp(this.serverUrl)
    this.token = await readToken()
    if (changed) {
      this.deskSecret = null
      this.inviteCallIds.clear()
      await persistDesk(null)
    } else if (!this.deskSecret) {
      this.deskSecret = await readDesk()
    }
    void this.ensureDesk()
  }

  async handleAuthUrl(url: string): Promise<void> {
    const token = tokenFromBonjourAuthUrl(url)
    if (token) await this.handleAuthToken(token)
  }

  async handleAuthToken(token: string): Promise<void> {
    this.token = token
    persistToken(token)
    try {
      await this.ensureDesk()
    } catch (error) {
      console.error('bonjour events', error)
    }
    try {
      await this.publishDeviceKey()
    } catch (error) {
      console.error('bonjour device key', error)
    }
    this.emit('bonjour:auth', await this.me())
    const win = this.liveWindow()
    win?.show()
    win?.focus()
  }

  login(): void {
    if (!this.serverUrl) return
    void this.openLogin()
  }

  private async openLogin(): Promise<void> {
    const loopback = await startAuthLoopback((token) => {
      void this.handleAuthToken(token).catch((error) => console.error('bonjour auth', error))
    })
    const login = new URL(`${this.serverUrl}/login`)
    login.searchParams.set('electron', '1')
    login.searchParams.set('loopback', loopback.url)
    void shell.openExternal(login.toString())
  }

  logout(): void {
    this.token = null
    persistToken(null)
    this.disconnectEvents()
    void this.ensureDesk()
    this.emit('bonjour:auth', null)
  }

  private require(): { token: string; http: TrpcHttp } {
    if (!this.token || !this.http) throw new Error('not signed in to Bonjour')
    return { token: this.token, http: this.http }
  }

  private requireDesk(): { secret: string; http: TrpcHttp } {
    if (!this.deskSecret || !this.http) throw new Error('bonjour invites are not ready')
    return { secret: this.deskSecret, http: this.http }
  }

  trackInviteCall(callId: string): void {
    this.inviteCallIds.add(callId)
  }

  private enqueueDesk<T>(task: () => Promise<T>): Promise<T> {
    const run = this.deskChain.then(task, task)
    this.deskChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async helloDesk(): Promise<void> {
    await this.enqueueDesk(async () => {
      if (!this.http) return
      const { publicX } = await this.identityKeys()
      const result = await this.http.mutate<{ deskId: string; secret: string }>(
        this.token,
        'invites.hello',
        { devicePublicKey: publicX },
        this.deskSecret,
      )
      const secretChanged = result.secret !== this.deskSecret
      this.deskSecret = result.secret
      persistDesk(result.secret)
      if (secretChanged && (this.token || this.deskSecret)) this.openEvents()
    })
  }

  private async ensureDesk(): Promise<void> {
    try {
      await this.helloDesk()
    } catch (error) {
      console.error('bonjour invite desk', error)
    }
    if ((this.token || this.deskSecret) && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
      this.openEvents()
    }
  }

  private async identityKeys(): Promise<{ secret: string; publicX: string }> {
    const identity = await loadOrCreateIdentity()
    const secret = Buffer.from(identity.privateKey).toString('base64')
    const publicX = encryptionPublicKey(Buffer.from(identity.publicKey).toString('base64'))
    return { secret, publicX }
  }

  async publishDeviceKey(): Promise<void> {
    const { token, http } = this.require()
    const { publicX } = await this.identityKeys()
    await http.mutate(token, 'account.setDevicePublicKey', { devicePublicKey: publicX })
  }

  async me(): Promise<BonjourMe | BonjourServerError> {
    if (!this.token || !this.http)
      return {
        error: BonjourServerErrorEnum.SERVER_UNAUTHORIZED,
      }
    try {
      return await this.http.query<BonjourMe>(this.token, 'account.me')
    } catch (error) {
      const err = error as unknown as { message?: string; cause?: { code?: string } }
      if (err.message?.includes('UNAUTHORIZED')) {
        return {
          error: BonjourServerErrorEnum.SERVER_UNAUTHORIZED,
        }
      }
      switch (err.cause?.code) {
        case 'UNAUTHORIZED':
          return {
            error: BonjourServerErrorEnum.SERVER_UNAUTHORIZED,
          }
        case 'EHOSTUNREACH':
          return {
            error: BonjourServerErrorEnum.SERVER_NOT_REACHABLE,
          }
        default:
          return {
            error: BonjourServerErrorEnum.SERVER_ERROR,
          }
      }
    }
  }

  async claimUsername(username: string): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'account.claimUsername', { username })
  }

  async setAcceptRequests(enabled: boolean): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'account.setAcceptRequests', { enabled })
  }

  async setAcceptCallJoins(enabled: boolean): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'account.setAcceptCallJoins', { enabled })
  }

  async contacts(): Promise<BonjourContact[]> {
    const { token, http } = this.require()
    return http.query(token, 'contacts.list')
  }

  async incoming(): Promise<BonjourRequest[]> {
    const { token, http } = this.require()
    return http.query(token, 'contacts.incoming')
  }

  async outgoing(): Promise<BonjourRequest[]> {
    const { token, http } = this.require()
    return http.query(token, 'contacts.outgoing')
  }

  async request(username: string): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'contacts.request', { username })
  }

  async retract(requestId: string): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'contacts.retract', { requestId })
  }

  async respond(requestId: string, action: 'accept' | 'decline'): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'contacts.respond', { requestId, action })
  }

  async ignore(requestId: string): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'contacts.ignore', { requestId })
  }

  async unignore(userId: string): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'contacts.unignore', { userId })
  }

  async ignored(): Promise<{ userId: string; username: string }[]> {
    const { token, http } = this.require()
    return http.query(token, 'contacts.ignored')
  }

  async removeContact(peerId: string): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'contacts.remove', { peerId })
  }

  async lists(): Promise<BonjourList[]> {
    const { token, http } = this.require()
    return http.query(token, 'lists.list')
  }

  async createList(name: string): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'lists.create', { name })
  }

  async renameList(listId: string, name: string): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'lists.rename', { listId, name })
  }

  async deleteList(listId: string): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'lists.delete', { listId })
  }

  async addListMember(listId: string, peerId: string): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'lists.addMember', { listId, peerId })
  }

  async removeListMember(listId: string, peerId: string): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'lists.removeMember', { listId, peerId })
  }

  async createInvite(): Promise<InviteCode> {
    const { secret, http } = this.requireDesk()
    return http.mutate(this.token, 'invites.create', {}, secret)
  }

  async listInvites(): Promise<InviteCode[]> {
    const { secret, http } = this.requireDesk()
    return http.query(this.token, 'invites.list', undefined, secret)
  }

  async revokeInvite(id: string): Promise<unknown> {
    const { secret, http } = this.requireDesk()
    return http.mutate(this.token, 'invites.revoke', { id }, secret)
  }

  async redeemInvite(token: string): Promise<InviteRedeemResult> {
    const { secret, http } = this.requireDesk()
    const result = await http.mutate<InviteRedeemResult>(
      this.token,
      'invites.redeem',
      { token },
      secret,
    )
    this.inviteCallIds.add(result.callId)
    return result
  }

  async startCall(peerId: string, kind: CallKind): Promise<{ callId: string }> {
    const { token, http } = this.require()
    return http.mutate(token, 'calls.start', { peerId, kind })
  }

  async acceptCall(callId: string): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'calls.accept', { callId })
  }

  async rejectCall(callId: string): Promise<unknown> {
    const { token, http } = this.require()
    return http.mutate(token, 'calls.reject', { callId })
  }

  async hangup(callId: string): Promise<unknown> {
    if (this.inviteCallIds.has(callId)) {
      const { secret, http } = this.requireDesk()
      return http.mutate(null, 'invites.hangup', { callId }, secret)
    }
    const { token, http } = this.require()
    return http.mutate(token, 'calls.hangup', { callId })
  }

  async signal(
    callId: string,
    type: SignalType,
    peerPublicKey: string,
    payload: PlainSignal,
  ): Promise<unknown> {
    const { secret } = await this.identityKeys()
    const ciphertext = encryptEnvelope({
      senderEd25519SecretB64: secret,
      recipientPublicKeyB64: peerPublicKey,
      payload,
    })
    if (this.inviteCallIds.has(callId)) {
      const desk = this.requireDesk()
      return desk.http.mutate(null, 'invites.signal', { callId, type, ciphertext }, desk.secret)
    }
    const { token, http } = this.require()
    return http.mutate(token, 'calls.signal', { callId, type, ciphertext })
  }

  async decryptSignal(ciphertext: string): Promise<PlainSignal> {
    const { secret } = await this.identityKeys()
    return decryptEnvelope({
      recipientEd25519SecretB64: secret,
      ciphertextB64: ciphertext,
    }) as PlainSignal
  }

  private async signalCiphertext(payload: BonjourEvent): Promise<string> {
    if (typeof payload.ciphertext === 'string' && payload.ciphertext.length > 0) {
      return payload.ciphertext
    }
    if (payload.ciphertextOmitted && typeof payload.id === 'string') {
      const callId = typeof payload.callId === 'string' ? payload.callId : ''
      if (this.inviteCallIds.has(callId) || !this.token) {
        const { secret, http } = this.requireDesk()
        const row = await http.query<{ ciphertext: string }>(
          null,
          'invites.getSignal',
          { id: payload.id },
          secret,
        )
        return row.ciphertext
      }
      const { token, http } = this.require()
      const row = await http.query<{ ciphertext: string }>(token, 'calls.getSignal', {
        id: payload.id,
      })
      return row.ciphertext
    }
    throw new Error('signal ciphertext missing')
  }

  private async dispatchEvent(payload: BonjourEvent): Promise<void> {
    if (payload.type === 'signal') {
      try {
        payload.plain = await this.decryptSignal(await this.signalCiphertext(payload))
      } catch {
        payload.plain = null
      }
    }
    this.emit('bonjour:event', payload)
  }

  setPresence(status: PresenceStatus): void {
    this.presence = status
    if (!this.token || !this.http) return
    void this.http.mutate(this.token, 'presence.heartbeat', { status }).catch(() => undefined)
  }

  private openEvents(): void {
    if (!this.serverUrl || (!this.token && !this.deskSecret)) return
    this.eventsGeneration += 1
    const generation = this.eventsGeneration
    this.clearEventsReconnect()
    this.ws?.close()
    this.ws = null
    const wsUrl = eventsWsUrl(this.serverUrl, { token: this.token, desk: this.deskSecret })
    const ws = new WebSocket(wsUrl)
    this.ws = ws
    ws.addEventListener('message', (event) => {
      if (generation !== this.eventsGeneration) return
      try {
        void this.dispatchEvent(JSON.parse(String(event.data)) as BonjourEvent)
      } catch (error) {
        console.error('bonjour event', error)
      }
    })
    const scheduleReconnect = (): void => {
      if (generation !== this.eventsGeneration) return
      if (this.ws === ws) this.ws = null
      this.clearEventsReconnect()
      this.eventsReconnect = setTimeout(() => {
        if (generation !== this.eventsGeneration || (!this.token && !this.deskSecret)) return
        this.openEvents()
      }, EVENTS_RECONNECT_MS)
    }
    ws.addEventListener('close', scheduleReconnect)
    ws.addEventListener('error', () => {
      if (generation !== this.eventsGeneration) return
      ws.close()
    })
    this.startHeartbeat()
  }

  private disconnectEvents(): void {
    this.eventsGeneration += 1
    this.clearEventsReconnect()
    this.stopHeartbeat()
    this.ws?.close()
    this.ws = null
  }

  private clearEventsReconnect(): void {
    if (this.eventsReconnect) clearTimeout(this.eventsReconnect)
    this.eventsReconnect = null
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => {
      this.setPresence(this.presence === 'offline' ? 'available' : this.presence)
      void this.helloDesk().catch((error) => console.error('bonjour invite desk', error))
    }, 30_000)
    this.setPresence(this.presence === 'offline' ? 'available' : this.presence)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }
}

export const bonjourClient = new BonjourClient()
