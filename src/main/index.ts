import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { reportIndexFailure, warnUnreadableIndex } from './dialogs'
import { bringsLegacyData, copyLegacyData, dataFolder } from './files/dataFolder'
import indexWorkerPath from './library/indexWorker?modulePath'
import { createMainWindow, isTrustedSender } from './mainWindow'
import { registerVideoScheme } from './playback/embedded/videoProtocol'
import { createServices, registerAllIpc, shutdownServices } from './services'

/**
 * The app's startup and shutdown. What the app is made of lives in `services.ts`, the window in
 * `mainWindow.ts`, and system dialogs in `dialogs.ts`.
 */

// The installed app and development runs keep separate data (PROJECT.md §7 Phase 6), so trying
// things out in development never touches a real library. Set before anything below opens it.
// Without this, Electron names the folder after package.json ("file-shuffler") for both.
app.setPath('userData', dataFolder(app.getPath('appData'), app.isPackaged))

// The built-in player streams through its own URL scheme, and a scheme can only be declared before
// the app is ready - after that the page would be refused by its own CSP (PROJECT.md §4).
registerVideoScheme()

// One copy of the app per data folder: two would write the same index and progress files and
// could each start mpv. The lock follows the data folder, so development and the installed app
// can still run side by side. A second launch focuses the open window instead (below), and
// exits here, before it opens anything.
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
  process.exit(0)
}

if (bringsLegacyData(app.isPackaged)) {
  // Development used that unpinned "file-shuffler" folder until now: bring its data across once.
  copyLegacyData(join(app.getPath('appData'), 'file-shuffler'), app.getPath('userData'))
}

let mainWindow: BrowserWindow | null = null

const services = createServices({
  dataFolder: app.getPath('userData'),
  resourcesPath: app.isPackaged ? process.resourcesPath : null,
  indexWorkerPath,
  window: () => mainWindow
})

// Anything that stops the index opening, other than damage it can recover from (a locked or
// unwritable file), leaves the app unable to do its job: say why and quit, rather than show a
// window where nothing works.
services.index.ready.catch((error: unknown) => {
  reportIndexFailure(error, app.getPath('userData'))
  app.exit(1)
})

function openWindow(): void {
  const window = createMainWindow()
  mainWindow = window
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.once('ready-to-show', () => {
    services.index.ready
      .then(({ setAside }) =>
        setAside === null ? undefined : warnUnreadableIndex(window, setAside)
      )
      // A failure to open at all is reported above.
      .catch(() => undefined)
  })
}

app.whenReady().then(() => {
  // Can only happen now: a protocol handler needs the app's session, which does not exist before
  // this point (PROJECT.md §4).
  services.startVideoStream()
  electronApp.setAppUserModelId('com.lucaswong.fileshuffler')

  // F12 opens DevTools in development; reload shortcuts are ignored in a build.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Opening the app again brings its window forward rather than starting a second copy.
  app.on('second-instance', () => {
    if (mainWindow === null || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  registerAllIpc(ipcMain, services, (event) => isTrustedSender(mainWindow, event))
  void services.settings.load()
  services.library.addDefaultRoots().catch(() => undefined)
  openWindow()
  // Reopens last time's folder where its cycle left off; the view updates when it's ready.
  void services.shuffler.restoreLastSession()

  app.on('activate', () => {
    // On macOS the dock icon reopens a window when none is open.
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
})

// Close mpv, cancel deletes still in their undo window, and close the index before the app exits
// (PROJECT.md §2.3).
let shutdownComplete = false
app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  void shutdownServices(services)
    .catch(() => undefined)
    .finally(() => {
      shutdownComplete = true
      app.quit()
    })
})

// Quit when all windows are closed, except on macOS, where apps stay open until quit explicitly.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
