import {
  app,
  ipcMain,
  nativeTheme,
  shell,
  type BrowserWindow,
  type IpcMain,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'path'
import { Worker } from 'node:worker_threads'
import { LIBRARY_CHANNELS } from '../shared/library'
import { SETTINGS_CHANNELS } from '../shared/settings'
import { CHANNELS } from '../shared/shuffler'
import { STATS_CHANNELS } from '../shared/stats'
import { IndexerService } from './app/indexerService'
import { SettingsService } from './app/settingsService'
import { ShufflerService } from './app/shufflerService'
import { StatsService } from './app/statsService'
import { pickFolder, pickMpvProgram } from './dialogs'
import { readDriveSpace } from './files/driveSpace'
import { fileDigest } from './files/fileDigest'
import { readFileIdentity } from './files/fileIdentity'
import { ProgressStore } from './files/progressStore'
import { SettingsStore } from './files/settingsStore'
import { listVideoFiles } from './files/videoFolder'
import { registerShufflerIpc } from './ipc'
import { connectIndexWorker, type IndexWorkerClient } from './library/workerIndexStore'
import { registerLibraryIpc } from './libraryIpc'
import { isTrustedSender, sendToWindow } from './mainWindow'
import { EmbeddedPlayer } from './playback/embedded/embeddedPlayer'
import { serveVideo } from './playback/embedded/videoProtocol'
import { VideoSources } from './playback/embedded/videoSources'
import { locateMpv, type MpvLocation } from './playback/mpv/findMpv'
import { KEY_LABELS, launchMpv } from './playback/mpv/mpvPlayer'
import { probeMpv } from './playback/mpv/probeMpv'
import { createPlayerTransport } from './playerIpc'
import { registerSettingsIpc } from './settingsIpc'
import { registerStatsIpc } from './statsIpc'

export interface ServiceOptions {
  /** The app's own data folder (PROJECT.md §2.8). */
  dataFolder: string
  /** Where a bundled mpv would be, or null in development. */
  resourcesPath: string | null
  /** The built index worker (`library/indexWorker.ts`). */
  indexWorkerPath: string
  /** The window, when one is open: dialogs attach to it and updates go to it. */
  window: () => BrowserWindow | null
}

export interface Services {
  /**
   * Starts serving the built-in player's video stream. Separate from building the services because
   * a protocol handler can only be registered once the app is ready, and the services are built
   * before that so the index can start opening.
   */
  startVideoStream: () => void
  index: IndexWorkerClient
  stats: StatsService
  shuffler: ShufflerService
  library: IndexerService
  settings: SettingsService
}

/**
 * Builds every service and connects them to Electron: the index worker, dialogs, the shell, and
 * updates to the window. The services themselves hold no Electron imports (PROJECT.md §5), so all
 * of that joining up happens here and nowhere else.
 */
export function createServices(options: ServiceOptions): Services {
  const { dataFolder, window } = options

  // The index and play history live in the data folder. A worker thread owns the database, so a
  // slow query never freezes the window (PROJECT.md §5 Measurements); requests sent before it has
  // opened simply wait. Opening there also sets a damaged index aside (`openIndex.ts`).
  const index = connectIndexWorker(
    new Worker(options.indexWorkerPath, { workerData: { file: join(dataFolder, 'index.db') } })
  )
  const db = index.store

  // Settings and shuffle progress are separate small files, so clearing data never costs settings.
  const settingsStore = new SettingsStore(join(dataFolder, 'settings.json'))
  const progress = new ProgressStore(join(dataFolder, 'progress.json'))

  /** Where to find mpv, given what (if anything) was chosen in Settings (PROJECT.md §4). */
  const mpvLocation = (chosen: string | null): MpvLocation =>
    locateMpv({
      env: process.env,
      platform: process.platform,
      resourcesPath: options.resourcesPath,
      chosen
    })

  const stats = new StatsService({ db })

  // The built-in player (PROJECT.md §4). The video element lives in the window, so "launching" it
  // is just wiring, not starting a process - but it still goes behind the same `PlaybackAdapter`,
  // which is what keeps the shuffle, the coordinator and the delete flow from knowing the
  // difference between this and mpv.
  const videoSources = new VideoSources()
  // Set once the page says its video surface exists. Until then a load would go nowhere, so the
  // adapter reports a failure rather than leaving the coordinator waiting.
  let videoSurfaceReady = false
  const playerTransport = createPlayerTransport({
    ipc: ipcMain,
    sources: videoSources,
    sendToWindow: (channel, payload) => sendToWindow(window(), channel, payload),
    isLive: () => videoSurfaceReady && window() !== null,
    isTrustedSender: (event) => isTrustedSender(window(), event),
    onReady: () => {
      videoSurfaceReady = true
    }
  })

  const shuffler = new ShufflerService({
    pickFolder: () => pickFolder(window(), 'shuffle'),
    listVideos: listVideoFiles,
    // Read at every launch, so a new choice in Settings applies to the next shuffle without a
    // restart - which also means the way back to mpv is one click and no relaunch.
    launchPlayer: async () => {
      const saved = await settingsStore.get()
      if (saved.player === 'builtin') {
        return new EmbeddedPlayer({
          transport: playerTransport.transport,
          // The last 1%: Matroska, AVI, WMV and the odd AC-3 soundtrack, which Chromium will not
          // decode. They open in whatever the system uses rather than being skipped, which is also
          // what lets mpv stop being a requirement (PROJECT.md §4).
          openExternally: (path) => shell.openPath(path)
        })
      }
      return launchMpv({ mpvPath: mpvLocation(saved.mpvPath).path })
    },
    // Rejects instead of deleting permanently when the item can't be recycled (PROJECT.md §2).
    trash: (path) => shell.trashItem(path),
    identify: readFileIdentity,
    playerKeys: KEY_LABELS,
    progress,
    // Play history is a record, not part of playback: a failed write never interrupts the shuffle.
    plays: {
      opened: (path, name, folder) => {
        db.recordOpened(path, name, folder)
          .then(() => stats.notifyChanged())
          .catch(() => undefined)
      },
      finished: (path) => {
        db.recordFinished(path)
          .then(() => stats.notifyChanged())
          .catch(() => undefined)
      }
    }
  })

  const library = new IndexerService({
    db,
    pickFolder: (purpose) => pickFolder(window(), purpose),
    driveSpace: readDriveSpace,
    // Opening goes through the OS, never a shell command, and only for paths the index holds
    // (checked in IndexerService).
    openPath: (path) => shell.openPath(path),
    revealPath: async (path) => {
      shell.showItemInFolder(path)
    },
    digest: fileDigest,
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

  const settings = new SettingsService({
    store: settingsStore,
    locate: mpvLocation,
    probe: probeMpv,
    pickProgram: () => pickMpvProgram(window()),
    clear: {
      plays: async () => {
        await db.clearPlays()
        await stats.notifyChanged()
      },
      favorites: async () => {
        await db.clearFavorites()
        await stats.notifyChanged()
      },
      progress: () => progress.clearAll(),
      index: async () => {
        await db.clearIndex()
        await Promise.all([library.notifyChanged(), stats.notifyChanged()])
      }
    },
    isScanning: () => library.isScanning(),
    // Electron's own theme override. Setting this also decides what `prefers-color-scheme` reports
    // to the page, so the entire UI follows from one line and the renderer knows nothing about it.
    applyAppearance: (value) => {
      nativeTheme.themeSource = value
    }
  })

  shuffler.onView((view) => sendToWindow(window(), CHANNELS.view, view))
  library.onView((view) => sendToWindow(window(), LIBRARY_CHANNELS.view, view))
  stats.onView((view) => sendToWindow(window(), STATS_CHANNELS.view, view))
  settings.onView((view) => sendToWindow(window(), SETTINGS_CHANNELS.view, view))

  return {
    startVideoStream: () => serveVideo(videoSources),
    index,
    stats,
    shuffler,
    library,
    settings
  }
}

/** Registers every renderer command, each checking its sender (PROJECT.md §5). */
export function registerAllIpc(
  ipc: IpcMain,
  services: Services,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
): void {
  registerShufflerIpc(ipc, services.shuffler, isTrustedSender)
  registerLibraryIpc(ipc, services.library, isTrustedSender)
  registerStatsIpc(ipc, services.stats, isTrustedSender)
  registerSettingsIpc(ipc, services.settings, isTrustedSender)
}

/**
 * Stops everything in order before the app exits: any scan, then the shuffler (closing mpv and
 * cancelling deletes still in their undo window, PROJECT.md §2.3), then the index. The shuffler
 * goes first so the play history it records on the way out is written; the worker finishes
 * requests in the order they were sent.
 */
export async function shutdownServices(services: Services): Promise<void> {
  services.library.dispose()
  try {
    await services.shuffler.dispose()
  } finally {
    await services.index.close()
  }
}
