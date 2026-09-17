import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

/**
 * Creates the app's one window with the security baseline (PROJECT.md §5): no Node access in the
 * page, which reaches the main process only through the narrow API in `src/preload`, and no way
 * to open other windows or navigate away. It shows itself once its first frame is ready.
 */
export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 760,
    minHeight: 540,
    show: false,
    title: 'FileShuffler',
    backgroundColor: '#0e1014',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.on('ready-to-show', () => window.show())

  // The app never opens other windows or navigates away from its own UI.
  // Same-URL navigation stays allowed so dev-mode reloads keep working.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })

  // electron-vite serves the page with hot reload in development; a build loads the bundled file.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

/** Only the app's own window, and only its top-level page, may send commands. */
export function isTrustedSender(window: BrowserWindow | null, event: IpcMainInvokeEvent): boolean {
  return (
    window !== null &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame !== null &&
    event.senderFrame === event.sender.mainFrame
  )
}

/** Sends an update to the window, if it is still open. */
export function sendToWindow(
  window: BrowserWindow | null,
  channel: string,
  payload: unknown
): void {
  if (window !== null && !window.isDestroyed()) window.webContents.send(channel, payload)
}
