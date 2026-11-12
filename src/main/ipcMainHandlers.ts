import type { SettingsData } from './stateKeeper'
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { createCallOverlayWindow } from './callOverlay'
import { settingsKeeper } from './stateKeeper'
import { OverlayBridge } from './sidecar/overlayBridge'
import { createAppSidecarManager } from './sidecar/sidecarManager'
import {
  displayPixelSize,
  lastShareSource,
  noteShareSurface,
  shareSurfaceFromFrame,
} from './screenPicker'
import type { OverlaySource } from './sidecar/protocol'
import { RemoteControlBridge, parseGrant } from './sidecar/remoteControlBridge'
import { capturedSidecarKeyToLocal, setLocalKeyCapture } from './sidecar/localKeyCapture'
import { DEFAULT_EMERGENCY_HOTKEY, isEmergencyHotkey } from '../shared/emergencyHotkey'
import { loadOrCreateIdentity } from './identityStore'
import { hasRoutableIpv6 } from './networkFamily'
import { bonjourClient } from './bonjour/client'
import { isClosedStreamError } from './bonjour/trpc'
import type { CallKind, PresenceStatus, SignalType } from './bonjour/types'

export const sidecarManager = createAppSidecarManager()
const overlayBridge = new OverlayBridge(sidecarManager)
const remoteControlBridge = new RemoteControlBridge(sidecarManager, () => sourceFromDisplay())

const sourceFromDisplay = (): OverlaySource => {
  const remembered = lastShareSource()
  if (remembered) return remembered
  const display = screen.getPrimaryDisplay()
  return {
    displayId: String(display.id),
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    },
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
  }
}

export const ipcMainHandlersInit = (): void => {
  let callOverlayWindow: BrowserWindow | null = null
  let callMainWindow: BrowserWindow | null = null
  let localCaptureTarget: Electron.WebContents | null = null
  overlayBridge.setShareSource(sourceFromDisplay())

  sidecarManager.on('captured-key', (payload) => {
    const wc = localCaptureTarget
    if (!wc || wc.isDestroyed()) return
    const event = capturedSidecarKeyToLocal(payload)
    if (!event) return
    wc.send('remoteControl:local-key', event)
  })
  let captureEpoch = 0
  let captureBlocked = false
  sidecarManager.on('remote-control-disabled', (event) => {
    captureEpoch += 1
    captureBlocked = true
    if (typeof event.generation === 'number' && Number.isFinite(event.generation)) {
      /* generation is owned by the sidecar; Electron only stops forwarding. */
    }
    const wc = localCaptureTarget
    localCaptureTarget = null
    if (wc && !wc.isDestroyed()) setLocalKeyCapture(wc, false)
  })
  sidecarManager.onStopped(() => {
    captureEpoch += 1
    captureBlocked = true
    const wc = localCaptureTarget
    localCaptureTarget = null
    if (wc && !wc.isDestroyed()) setLocalKeyCapture(wc, false)
  })
  screen.on('display-metrics-changed', () => {
    overlayBridge.setShareSource(sourceFromDisplay())
  })

  const fromCallOverlay = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    Boolean(callOverlayWindow && event.sender.id === callOverlayWindow.webContents.id)

  const fromCallMain = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    Boolean(callMainWindow && event.sender.id === callMainWindow.webContents.id)

  const fromMainSession = (event: Electron.IpcMainInvokeEvent): boolean => {
    if (fromCallOverlay(event)) return false
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return false
    if (callMainWindow) return fromCallMain(event)
    remoteControlBridge.setMainWindow(win)
    return true
  }

  void settingsKeeper().then((keeper) => {
    const hotkey = keeper.get().emergencyHotkey
    if (isEmergencyHotkey(hotkey)) remoteControlBridge.setHotkey(hotkey)
    else remoteControlBridge.setHotkey(DEFAULT_EMERGENCY_HOTKEY)
  })

  ipcMain.handle('toggleRemoteCursors', async (_, state) => {
    const source = sourceFromDisplay()
    overlayBridge.setShareSource(source)
    console.info('[share-surface] toggle cursors', {
      enabled: Boolean(state),
      windowShare: Boolean(source.windowShare),
      sourceId: source.sourceId ?? null,
      bounds: source.bounds,
      scaleFactor: source.scaleFactor,
    })
    await overlayBridge.toggle(Boolean(state))
  })
  ipcMain.handle('updateRemoteCursor', async (_, state): Promise<void> => {
    await overlayBridge.updateCursor(state)
  })
  ipcMain.handle('remoteCursorPing', async (_, cursorId): Promise<void> => {
    await overlayBridge.ping(cursorId)
  })
  ipcMain.handle('removeRemoteCursor', async (_, peerId): Promise<void> => {
    await overlayBridge.removeCursor(peerId)
  })
  ipcMain.handle('setCursorShareSource', async (_, source: OverlaySource | null): Promise<void> => {
    overlayBridge.setShareSource(source)
  })
  ipcMain.handle(
    'setShareDisplaySurface',
    async (
      _,
      reported: unknown,
      width: unknown,
      height: unknown,
    ): Promise<'monitor' | 'window' | 'browser' | null> => {
      const surface = typeof reported === 'string' ? reported : undefined
      const frame = {
        width: typeof width === 'number' && Number.isFinite(width) ? width : 0,
        height: typeof height === 'number' && Number.isFinite(height) ? height : 0,
      }
      const displays = screen.getAllDisplays().map((display) => ({
        id: display.id,
        bounds: display.bounds,
        scaleFactor: display.scaleFactor,
        pixel: displayPixelSize(display.bounds, display.scaleFactor),
      }))
      const resolved = shareSurfaceFromFrame(
        surface,
        frame,
        displays.map((display) => display.pixel),
      )
      const before = lastShareSource()
      console.info('[share-surface] classify', {
        reported: surface ?? null,
        frame,
        displays,
        resolved,
        rememberedBefore: before
          ? {
              sourceId: before.sourceId ?? null,
              windowShare: Boolean(before.windowShare),
              bounds: before.bounds,
              scaleFactor: before.scaleFactor,
            }
          : null,
      })
      if (!resolved) return null
      noteShareSurface(resolved)
      const after = sourceFromDisplay()
      overlayBridge.setShareSource(after)
      console.info('[share-surface] applied', {
        resolved,
        windowShare: Boolean(after.windowShare),
        sourceId: after.sourceId ?? null,
        bounds: after.bounds,
        scaleFactor: after.scaleFactor,
      })
      return resolved
    },
  )
  ipcMain.handle('getSidecarCapabilities', async () => sidecarManager.getCapabilities())
  ipcMain.handle('remoteControl:getCapabilities', async (event) => {
    if (!fromMainSession(event)) return sidecarManager.getCapabilities()
    if (sidecarManager.isStarted()) await sidecarManager.refreshCapabilities()
    return remoteControlBridge.getCapabilities()
  })
  ipcMain.handle('remoteControl:arm', async (event, grant) => {
    if (!fromMainSession(event)) throw new Error('unauthorized')
    const parsed = parseGrant(grant)
    if (!parsed) throw new Error('invalid grant')
    const record = grant && typeof grant === 'object' ? (grant as Record<string, unknown>) : {}
    const generation = typeof record.generation === 'number' ? record.generation : undefined
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined
    const peerId = typeof record.peerId === 'string' ? record.peerId : undefined
    await remoteControlBridge.arm({ ...parsed, generation, sessionId, peerId })
  })
  ipcMain.handle('remoteControl:disarm', async (event) => {
    if (!fromMainSession(event)) throw new Error('unauthorized')
    await remoteControlBridge.disarm()
  })
  ipcMain.handle('remoteControl:pointerMove', async (event, input) => {
    if (!fromMainSession(event)) return
    await remoteControlBridge.pointerMove(input)
  })
  ipcMain.handle('remoteControl:pointerButton', async (event, input) => {
    if (!fromMainSession(event)) return
    await remoteControlBridge.pointerButton(input)
  })
  ipcMain.handle('remoteControl:wheel', async (event, input) => {
    if (!fromMainSession(event)) return
    await remoteControlBridge.wheel(input)
  })
  ipcMain.handle('remoteControl:key', async (event, input) => {
    if (!fromMainSession(event)) return
    await remoteControlBridge.key(input)
  })
  ipcMain.handle('remoteControl:releaseAll', async (event) => {
    if (!fromMainSession(event)) return
    await remoteControlBridge.releaseAll()
  })
  ipcMain.handle('remoteControl:recheck', async (event) => {
    if (!fromMainSession(event)) return sidecarManager.getCapabilities()
    return remoteControlBridge.recheck()
  })
  ipcMain.handle('remoteControl:requestPermission', async (event, capability: unknown) => {
    if (!fromMainSession(event)) return
    await remoteControlBridge.requestPermission(capability === 'listen' ? 'listen' : 'post')
  })
  ipcMain.handle('remoteControl:setLocalCapture', async (event, enabled: boolean) => {
    if (!fromMainSession(event)) return
    const wc = event.sender
    if (!enabled) {
      captureBlocked = false
      if (localCaptureTarget === wc) localCaptureTarget = null
      if (sidecarManager.isStarted()) {
        await sidecarManager.send('keyboard-capture-disarm', {}).catch(() => undefined)
      }
      setLocalKeyCapture(wc, false)
      return
    }
    if (captureBlocked) {
      setLocalKeyCapture(wc, false)
      return
    }
    const epoch = captureEpoch
    localCaptureTarget = wc
    let sidecarOk = false
    if (sidecarManager.isStarted()) {
      try {
        const res = await sidecarManager.send('keyboard-capture-arm', {
          emergencyGeneration: remoteControlBridge.getEmergencyGeneration(),
        })
        sidecarOk = res.type === 'ok'
      } catch {
        sidecarOk = false
      }
    }
    if (epoch !== captureEpoch || captureBlocked) {
      if (sidecarManager.isStarted()) {
        await sidecarManager.send('keyboard-capture-disarm', {}).catch(() => undefined)
      }
      if (localCaptureTarget === wc) localCaptureTarget = null
      setLocalKeyCapture(wc, false)
      return
    }
    setLocalKeyCapture(wc, true, { forward: !sidecarOk })
  })
  ipcMain.handle('updateSettings', async (_, settings): Promise<void> => {
    const settingsKeeperInstance = await settingsKeeper()
    settingsKeeperInstance.set(settings)
    sidecarManager.setDebugLogs(Boolean(settings?.debugLogsEnabled))
    if (isEmergencyHotkey(settings?.emergencyHotkey)) {
      remoteControlBridge.setHotkey(settings.emergencyHotkey)
    }
    if (settings?.bonjourEnabled && settings?.bonjourServerUrl) {
      await bonjourClient.configured(String(settings.bonjourServerUrl))
    }
  })
  ipcMain.handle('getSettings', async (): Promise<SettingsData> => {
    const settingsKeeperInstance = await settingsKeeper()
    return settingsKeeperInstance.get()
  })
  ipcMain.handle('getAppVersion', (): string => {
    return app.getVersion()
  })
  ipcMain.handle('hasRoutableIpv6', (): boolean => hasRoutableIpv6())
  ipcMain.handle('getDeviceIdentity', () => {
    const identity = loadOrCreateIdentity()
    return {
      publicKey: Buffer.from(identity.publicKey).toString('base64'),
      privateKey: Buffer.from(identity.privateKey).toString('base64'),
      fingerprint: identity.fingerprint,
    }
  })

  ipcMain.handle('toggleCallOverlay', async (event, open: boolean): Promise<void> => {
    callMainWindow = BrowserWindow.fromWebContents(event.sender)
    remoteControlBridge.setMainWindow(callMainWindow)
    if (open) {
      if (callOverlayWindow && !callOverlayWindow.isDestroyed()) {
        callOverlayWindow.show()
        callOverlayWindow.focus()
        callOverlayWindow.webContents.send('call-request-sync')
        return
      }
      callOverlayWindow = await createCallOverlayWindow()
      callOverlayWindow.on('closed', () => {
        callOverlayWindow = null
        callMainWindow?.webContents.send('callOverlayClosed')
      })
      return
    }
    if (callOverlayWindow && !callOverlayWindow.isDestroyed()) {
      callOverlayWindow.close()
    }
  })
  ipcMain.handle('setCallOverlayVisible', async (_, visible: boolean): Promise<void> => {
    if (!callOverlayWindow || callOverlayWindow.isDestroyed()) return
    if (visible) callOverlayWindow.showInactive()
    else callOverlayWindow.hide()
  })

  ipcMain.on('call-overlay-ready', (event) => {
    if (!fromCallOverlay(event)) return
    callMainWindow?.webContents.send('call-overlay-ready')
  })
  ipcMain.on('call-chat-send', (event, text: string) => {
    if (!fromCallOverlay(event)) return
    callMainWindow?.webContents.send('call-chat-send', text)
  })
  ipcMain.on('call-toggle-camera', (event) => {
    if (!fromCallOverlay(event)) return
    callMainWindow?.webContents.send('call-toggle-camera')
  })
  ipcMain.on('call-loop-answer', (event, sdp: unknown) => {
    if (!fromCallOverlay(event)) return
    callMainWindow?.webContents.send('call-loop-answer', sdp)
  })
  ipcMain.on('call-loop-ice', (event, candidate: unknown) => {
    if (fromCallOverlay(event)) {
      callMainWindow?.webContents.send('call-loop-ice', candidate)
      return
    }
    if (fromCallMain(event)) {
      callOverlayWindow?.webContents.send('call-loop-ice', candidate)
    }
  })
  ipcMain.on('call-loop-offer', (event, sdp: unknown) => {
    if (!fromCallMain(event)) return
    callOverlayWindow?.webContents.send('call-loop-offer', sdp)
  })
  ipcMain.on('call-chat', (event, messages: unknown) => {
    if (!fromCallMain(event)) return
    callOverlayWindow?.webContents.send('call-chat', messages)
  })
  ipcMain.on('call-peers', (event, peers: unknown) => {
    if (!fromCallMain(event)) return
    callOverlayWindow?.webContents.send('call-peers', peers)
  })
  ipcMain.on('call-camera-mids', (event, mids: unknown) => {
    if (!fromCallMain(event)) return
    callOverlayWindow?.webContents.send('call-camera-mids', mids)
  })

  ipcMain.handle('bonjour:login', async () => {
    bonjourClient.login()
  })
  ipcMain.handle('bonjour:logout', async () => {
    bonjourClient.logout()
  })
  ipcMain.handle('bonjour:me', async () => bonjourClient.me())
  ipcMain.handle('bonjour:claimUsername', async (_, username: string) =>
    bonjourClient.claimUsername(username),
  )
  ipcMain.handle('bonjour:setAcceptRequests', async (_, enabled: boolean) =>
    bonjourClient.setAcceptRequests(enabled),
  )
  ipcMain.handle('bonjour:setAcceptCallJoins', async (_, enabled: boolean) =>
    bonjourClient.setAcceptCallJoins(enabled),
  )
  ipcMain.handle('bonjour:contacts', async () => bonjourClient.contacts())
  ipcMain.handle('bonjour:incoming', async () => bonjourClient.incoming())
  ipcMain.handle('bonjour:outgoing', async () => bonjourClient.outgoing())
  ipcMain.handle('bonjour:request', async (_, username: string) => bonjourClient.request(username))
  ipcMain.handle('bonjour:retract', async (_, requestId: string) =>
    bonjourClient.retract(requestId),
  )
  ipcMain.handle('bonjour:respond', async (_, requestId: string, action: 'accept' | 'decline') =>
    bonjourClient.respond(requestId, action),
  )
  ipcMain.handle('bonjour:ignore', async (_, requestId: string) => bonjourClient.ignore(requestId))
  ipcMain.handle('bonjour:unignore', async (_, userId: string) => bonjourClient.unignore(userId))
  ipcMain.handle('bonjour:ignored', async () => bonjourClient.ignored())
  ipcMain.handle('bonjour:removeContact', async (_, peerId: string) =>
    bonjourClient.removeContact(peerId),
  )
  ipcMain.handle('bonjour:lists', async () => bonjourClient.lists())
  ipcMain.handle('bonjour:createList', async (_, name: string) => bonjourClient.createList(name))
  ipcMain.handle('bonjour:renameList', async (_, listId: string, name: string) =>
    bonjourClient.renameList(listId, name),
  )
  ipcMain.handle('bonjour:deleteList', async (_, listId: string) =>
    bonjourClient.deleteList(listId),
  )
  ipcMain.handle('bonjour:addListMember', async (_, listId: string, peerId: string) =>
    bonjourClient.addListMember(listId, peerId),
  )
  ipcMain.handle('bonjour:removeListMember', async (_, listId: string, peerId: string) =>
    bonjourClient.removeListMember(listId, peerId),
  )
  ipcMain.handle('bonjour:createInvite', async () => bonjourClient.createInvite())
  ipcMain.handle('bonjour:listInvites', async () => bonjourClient.listInvites())
  ipcMain.handle('bonjour:revokeInvite', async (_, id: string) => bonjourClient.revokeInvite(id))
  ipcMain.handle('bonjour:redeemInvite', async (_, token: string) =>
    bonjourClient.redeemInvite(token),
  )
  ipcMain.handle('bonjour:trackInviteCall', async (_, callId: string) => {
    bonjourClient.trackInviteCall(callId)
  })
  ipcMain.handle('bonjour:startCall', async (_, peerId: string, kind: CallKind) =>
    bonjourClient.startCall(peerId, kind),
  )
  ipcMain.handle('bonjour:acceptCall', async (_, callId: string) =>
    bonjourClient.acceptCall(callId),
  )
  ipcMain.handle('bonjour:rejectCall', async (_, callId: string) =>
    bonjourClient.rejectCall(callId),
  )
  ipcMain.handle('bonjour:hangup', async (_, callId: string) => bonjourClient.hangup(callId))
  ipcMain.handle(
    'bonjour:signal',
    async (_, callId: string, type: SignalType, peerPublicKey: string, payload: unknown) => {
      try {
        return await bonjourClient.signal(callId, type, peerPublicKey, payload as never)
      } catch (error) {
        if (isClosedStreamError(error)) return
        throw error
      }
    },
  )
  ipcMain.handle('bonjour:setPresence', async (_, status: PresenceStatus) => {
    bonjourClient.setPresence(status)
  })
}
