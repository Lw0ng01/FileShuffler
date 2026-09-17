import {
  BrowserWindow,
  nativeTheme,
  type BrowserWindowConstructorOptions,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

/**
 * The opaque colour behind the page, which has to match the theme or the window flashes the wrong
 * colour before the first frame paints. It was hard-coded dark, so a light-mode user saw a dark
 * flash at every launch.
 */
const WINDOW_BACKGROUND = { dark: '#1c1c1e', light: '#ececf0' }

function backgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light
}

/**
 * Native window material, so the app reads as a desktop app rather than a page inside a frame.
 *
 * macOS gets the full treatment: the title bar is hidden so the sidebar runs to the top edge, and
 * the window is translucent behind it. `backgroundColor` has to be clear for that translucency to
 * show; the page paints its own background over everything except the sidebar.
 *
 * Windows deliberately keeps its normal frame and only takes the Mica material. Hiding the title
 * bar there means drawing the window controls with `titleBarOverlay` and reserving space for them,
 * and none of that can be checked from a Mac - an undraggable window would be worse than a plain
 * one. Finish it in a Windows session (PROJECT.md).
 */
function windowChrome(): BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 20 },
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000'
    }
  }
  if (process.platform === 'win32') {
    return { backgroundMaterial: 'mica', backgroundColor: backgroundColor() }
  }
  return { backgroundColor: backgroundColor() }
}

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
    autoHideMenuBar: true,
    ...windowChrome(),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.on('ready-to-show', () => window.show())

  // Following the system theme means following it while running, not only at launch. macOS keeps
  // its clear background so the vibrancy stays visible.
  if (process.platform !== 'darwin') {
    const onThemeChange = (): void => {
      if (!window.isDestroyed()) window.setBackgroundColor(backgroundColor())
    }
    nativeTheme.on('updated', onThemeChange)
    window.on('closed', () => nativeTheme.off('updated', onThemeChange))
  }

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
