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
 * `--bg` from `styles.css`, and the two have to be changed together: the light value was left
 * behind at `#ececf0` when the palette moved to `#f2f2f7`, which flashed the older, greyer
 * background at every launch.
 *
 * Used for the window itself only where there is no material to show through it, and for the
 * colour Windows draws its window controls on - which sit over `.main`, where the page does paint
 * this. It was once hard-coded dark, so a light-mode user saw a dark flash at every launch.
 */
const WINDOW_BACKGROUND = { dark: '#1c1c1e', light: '#f2f2f7' }

/** `--text`, for the window control glyphs Windows draws over our own background. */
const CONTROL_SYMBOL = { dark: '#f5f5f7', light: '#1d1d1f' }

/**
 * The height reserved for Windows' window controls. 40px rather than the system's 32: the controls
 * sit in the 46px of clearance the page already leaves at the top (`.is-windows` in `styles.css`),
 * and filling more of it keeps them from looking stranded above the first heading. Changing this
 * means changing that clearance too.
 */
const TITLEBAR_HEIGHT = 40

function backgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light
}

/**
 * Windows draws the minimise, maximise and close buttons itself, over the top-right of our page,
 * so it needs to be told what they sit on. Both colours follow the theme, and so must be reapplied
 * with `setTitleBarOverlay` when it changes - unlike `vibrancy` on macOS, nothing here adapts on
 * its own, and dark glyphs on a dark background would be invisible.
 */
function titleBarOverlay(): { color: string; symbolColor: string; height: number } {
  return {
    color: backgroundColor(),
    symbolColor: nativeTheme.shouldUseDarkColors ? CONTROL_SYMBOL.dark : CONTROL_SYMBOL.light,
    height: TITLEBAR_HEIGHT
  }
}

/**
 * Native window material, so the app reads as a desktop app rather than a page inside a frame.
 *
 * macOS gets the full treatment: the title bar is hidden so the sidebar runs to the top edge, and
 * the window is translucent behind it. `backgroundColor` has to be clear for that translucency to
 * show.
 *
 * Both materials went unseen from the day they were set, because `body` painted an opaque `--bg`
 * across the whole window and the transparent `--sidebar` sat on that rather than on the material.
 * The page now paints that surface on `.main` alone (Lucas, 2026-09-17), so the sidebar - and only
 * the sidebar - is genuinely see-through. Give `--sidebar` a real colour on any platform that has
 * no material to show.
 *
 * Windows now hides its title bar too, so the sidebar reaches the top edge there as well. It keeps
 * the Mica material, and `titleBarOverlay` leaves the window controls native: Windows draws them
 * itself, in the right place, with the hover and snap behaviour people expect - drawing our own
 * would have meant reimplementing all of that badly.
 *
 * What the window can be dragged by is then entirely ours to get right. The sidebar is the handle
 * on both platforms, which is why every control inside it opts out of the drag region.
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
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: titleBarOverlay(),
      backgroundMaterial: 'mica',
      // Clear, for the same reason macOS is: an opaque window background paints over the material
      // and nothing shows through the sidebar. The page keeps its own opaque surface on `.main`, so
      // only the sidebar is actually see-through.
      backgroundColor: '#00000000'
    }
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

  // Following the system theme means following it while running, not only at launch. Both platforms
  // with a window material keep their clear background, so it must not be reassigned here: setting
  // an opaque colour would paint over the material and the sidebar would stop being translucent.
  if (process.platform === 'win32') {
    const onThemeChange = (): void => {
      // The window controls are drawn by Windows, not by the page, so switching to Light in
      // Settings would otherwise leave light glyphs on the new light background.
      if (!window.isDestroyed()) window.setTitleBarOverlay(titleBarOverlay())
    }
    nativeTheme.on('updated', onThemeChange)
    window.on('closed', () => nativeTheme.off('updated', onThemeChange))
  } else if (process.platform !== 'darwin') {
    // No material here, so the window's own colour is what shows before the first frame paints.
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
