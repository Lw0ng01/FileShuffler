import {
  BrowserWindow,
  nativeTheme,
  type BrowserWindowConstructorOptions,
  type IpcMainEvent,
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
 * with `setTitleBarOverlay` when it changes - nothing here adapts on its own, and dark glyphs on a
 * dark background would be invisible.
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
 * **Windows takes no material, on purpose** (Lucas, 2026-09-17). Mica was tried: the sidebar was
 * made translucent so it would show, and the cost was that Windows owns the tint *and* re-tints it
 * with a ~225ms crossfade, so the sidebar visibly trailed the page on every theme change. Cutting
 * the transparency to 15% left a tail that was still visible. A translucent sidebar and an instant
 * theme switch are one decision, and the switch won - so the page is opaque throughout and the
 * window needs no material behind it.
 *
 * **macOS takes no material either, for the same reason** (settled on the Mac, 2026-09-22).
 * `vibrancy: 'sidebar'` could only ever show through a translucent sidebar, and `--sidebar` is
 * `var(--panel)` in both palettes - a solid colour - so it had nothing left to show once the
 * translucency was reversed. It is gone, and with it the clear `backgroundColor` it required:
 * a transparent window with an opaque page is just a see-through flash waiting for the first
 * frame, which is exactly why Windows does not do it either.
 *
 * Windows hides its title bar too, so the sidebar reaches the top edge there as well, and
 * `titleBarOverlay` leaves the window controls native: Windows draws them itself, in the right
 * place, with the hover and snap behaviour people expect - drawing our own would have meant
 * reimplementing all of that badly.
 *
 * What the window can be dragged by is then entirely ours to get right. The sidebar is the handle
 * on both platforms, which is why every control inside it opts out of the drag region.
 */
function windowChrome(): BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 20 },
      backgroundColor: backgroundColor()
    }
  }
  if (process.platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: titleBarOverlay(),
      // No `backgroundMaterial` here any more. Mica can only show where the page does not paint,
      // and the page now paints everywhere, so it would be a setting that does nothing - and a
      // clear `backgroundColor` alongside it would only risk a see-through window before the first
      // frame arrives.
      backgroundColor: backgroundColor()
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

  // Following the system theme means following it while running, not only at launch. Every
  // platform needs this now: macOS was skipped while its background was clear for the vibrancy,
  // and now that it has a real background, it would otherwise keep the launch colour for the rest
  // of the session and flash it on the next reload.
  const onThemeChange = (): void => {
    if (window.isDestroyed()) return
    // What shows before the first frame paints, so it has to follow the theme too.
    window.setBackgroundColor(backgroundColor())
    // The window controls are drawn by Windows, not by the page, so switching to Light in
    // Settings would otherwise leave light glyphs on the new light background.
    if (process.platform === 'win32') window.setTitleBarOverlay(titleBarOverlay())
  }
  nativeTheme.on('updated', onThemeChange)
  window.on('closed', () => nativeTheme.off('updated', onThemeChange))

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

/**
 * Only the app's own window, and only its top-level page, may send commands. Takes both kinds of
 * event because the built-in player reports playback one-way rather than through `invoke`, and
 * there should be exactly one answer to "is this really our page?".
 */
export function isTrustedSender(
  window: BrowserWindow | null,
  event: IpcMainInvokeEvent | IpcMainEvent
): boolean {
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
