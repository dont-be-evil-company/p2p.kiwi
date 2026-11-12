import { app, shell, BrowserWindow } from 'electron'
import path from 'path'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { applyChromiumFlags } from './chromiumFlags'
import { windowStateKeeper, settingsKeeper } from './stateKeeper'
import { ipcMainHandlersInit, sidecarManager } from './ipcMainHandlers'
import { installDisplayMediaHandler } from './screenPicker'
import { isInProductionMode } from './utils'
import { bonjourClient } from './bonjour/client'
import { isBonjourAuthUrl } from './bonjour/urls'
import { kiwiUrlFromArgv } from './kiwiUrl'

applyChromiumFlags()

const CUSTOM_PROTOCOL = 'kiwi'
const LEGACY_PROTOCOL = 'bananas'

const hasSingleInstanceLock = !isInProductionMode() || app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  let MAIN_WINDOW: BrowserWindow | null = null
  let rendererReady = false
  let pendingKiwiUrl: string | null = null

  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(CUSTOM_PROTOCOL, process.execPath, [
        path.resolve(process.argv[1]),
      ])
      app.setAsDefaultProtocolClient(LEGACY_PROTOCOL, process.execPath, [
        path.resolve(process.argv[1]),
      ])
    }
  } else {
    app.setAsDefaultProtocolClient(CUSTOM_PROTOCOL)
    app.setAsDefaultProtocolClient(LEGACY_PROTOCOL)
  }

  const deliverKiwiUrl = (url: string): void => {
    if (!rendererReady || !MAIN_WINDOW || MAIN_WINDOW.isDestroyed()) {
      pendingKiwiUrl = url
      return
    }
    if (isBonjourAuthUrl(url)) {
      void bonjourClient.handleAuthUrl(url)
      return
    }
    MAIN_WINDOW.webContents.send('openKiwiURL', url)
  }

  const flushPendingKiwiUrl = (): void => {
    rendererReady = true
    if (!pendingKiwiUrl) return
    const url = pendingKiwiUrl
    pendingKiwiUrl = null
    deliverKiwiUrl(url)
  }

  app.on('second-instance', (_, commandLine) => {
    if (MAIN_WINDOW && !MAIN_WINDOW.isDestroyed()) {
      if (MAIN_WINDOW.isMinimized()) MAIN_WINDOW.restore()
      MAIN_WINDOW.focus()
    }
    const url = kiwiUrlFromArgv(commandLine)
    if (url) deliverKiwiUrl(url)
  })

  app.on('open-url', (evt, url: string) => {
    evt.preventDefault()
    deliverKiwiUrl(url)
  })

  async function createWindow(): Promise<void> {
    const mainWindowState = await windowStateKeeper('main')
    rendererReady = false

    const win = new BrowserWindow({
      width: mainWindowState.width,
      height: mainWindowState.height,
      minWidth: 400,
      minHeight: 200,
      x: mainWindowState.x,
      y: mainWindowState.y,
      show: false,
      autoHideMenuBar: true,
      ...(process.platform === 'linux' ? { icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: true,
      },
    })
    MAIN_WINDOW = win

    mainWindowState.track(win)

    installDisplayMediaHandler(() => win)

    win.webContents.on('did-finish-load', () => {
      flushPendingKiwiUrl()
    })

    win.on('ready-to-show', () => {
      win.show()
    })

    win.on('close', () => {
      for (const other of BrowserWindow.getAllWindows()) {
        if (other !== win) other.close()
      }
    })

    win.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'))
    }

    if (mainWindowState.isMaximized) {
      MAIN_WINDOW.maximize()
    }
  }

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('kiwi.p2p.desktop')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    ipcMainHandlersInit()

    const settings = await settingsKeeper()
    sidecarManager.setDebugLogs(Boolean(settings.get().debugLogsEnabled))
    void sidecarManager.start()
    const prefs = settings.get()

    const coldStartUrl = kiwiUrlFromArgv(process.argv)
    if (coldStartUrl) pendingKiwiUrl = coldStartUrl

    await createWindow()
    if (MAIN_WINDOW) bonjourClient.attachWindow(MAIN_WINDOW)
    if (prefs.bonjourEnabled) await bonjourClient.configured(prefs.bonjourServerUrl)

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', () => {
    void sidecarManager.stop()
  })
}
