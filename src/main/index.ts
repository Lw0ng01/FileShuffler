import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { LIBRARY_CHANNELS } from '../shared/library'
import { CHANNELS } from '../shared/shuffler'
import { IndexerService } from './app/indexerService'
import { ShufflerService } from './app/shufflerService'
import { IndexDb } from './library/indexDb'
import { registerLibraryIpc } from './libraryIpc'
import { readDriveSpace } from './files/driveSpace'
import { readFileIdentity } from './files/fileIdentity'
import { ProgressStore } from './files/progressStore'
import { listVideoFiles } from './files/videoFolder'
import { registerShufflerIpc } from './ipc'
import { findMpv } from './playback/mpv/findMpv'
import { KEY_LABELS, launchMpv } from './playback/mpv/mpvPlayer'

let mainWindow: BrowserWindow | null = null

const shuffler = new ShufflerService({
  pickFolder: async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a folder of videos',
      buttonLabel: 'Shuffle this folder',
      properties: ['openDirectory']
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  },
  listVideos: listVideoFiles,
  launchPlayer: () =>
    launchMpv({
      mpvPath: findMpv({
        env: process.env,
        platform: process.platform,
        resourcesPath: app.isPackaged ? process.resourcesPath : null
      })
    }),
  // Rejects instead of deleting permanently when the item can't be recycled (PROJECT.md §2).
  trash: (path) => shell.trashItem(path),
  identify: readFileIdentity,
  playerKeys: KEY_LABELS,
  // Stays in the app's own data folder, never with the user's files (PROJECT.md §2.8).
  progress: new ProgressStore(join(app.getPath('userData'), 'progress.json'))
})

shuffler.onView((view) => {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(CHANNELS.view, view)
  }
})

// The index lives beside the shuffler's progress, in the app's own data folder (PROJECT.md §2.8).
const indexDb = new IndexDb(join(app.getPath('userData'), 'index.db'))
const library = new IndexerService({
  db: indexDb,
  pickFolder: async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a folder to index',
      buttonLabel: 'Index this folder',
      properties: ['openDirectory']
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  },
  driveSpace: readDriveSpace,
  // Offered on a first run. Electron throws for a folder this system doesn't define, so each one
  // is asked for separately and a missing one is simply left out.
  defaultRoots: () =>
    (['videos', 'pictures', 'music', 'documents', 'downloads'] as const).flatMap((name) => {
      try {
        return [app.getPath(name)]
      } catch {
        return []
      }
    })
})

library.onView((view) => {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(LIBRARY_CHANNELS.view, view)
  }
})

/** Only the app's own window, and only its top-level page, may send commands. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  return (
    mainWindow !== null &&
    event.sender === mainWindow.webContents &&
    event.senderFrame !== null &&
    event.senderFrame === event.sender.mainFrame
  )
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
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
      // Security baseline (PROJECT.md §5): the renderer has no Node access and reaches the main
      // process only through the narrow API defined in src/preload.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const window = mainWindow

  window.on('ready-to-show', () => {
    window.show()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  // The app never opens other windows or navigates away from its own UI.
  // Same-URL navigation stays allowed so dev-mode reloads keep working.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.lucaswong.fileshuffler')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerShufflerIpc(ipcMain, shuffler, isTrustedSender)
  registerLibraryIpc(ipcMain, library, isTrustedSender)
  library.addDefaultRoots()
  createWindow()
  // Reopens last time's folder where its cycle left off; the view updates when it's ready.
  void shuffler.restoreLastSession()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Close mpv and cancel deletes still in their undo window before the app exits (PROJECT.md §2.3).
let shutdownComplete = false
app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  library.dispose()
  shuffler.dispose().finally(() => {
    indexDb.close()
    shutdownComplete = true
    app.quit()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
