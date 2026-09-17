import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { LIBRARY_CHANNELS, type LibraryApi, type LibraryView } from '../shared/library'
import { CHANNELS, type ShufflerApi, type ShufflerView } from '../shared/shuffler'
import { SETTINGS_CHANNELS, type SettingsApi, type SettingsView } from '../shared/settings'
import { STATS_CHANNELS, type StatsApi, type StatsView } from '../shared/stats'

// The only surface the renderer can reach (PROJECT.md §5). Each function maps to one fixed
// channel; ipcRenderer itself, arbitrary channels, paths and shell access are never exposed.
// The main process validates the sender and every argument again (src/main/ipc.ts).
const shuffler: ShufflerApi = {
  getView: () => ipcRenderer.invoke(CHANNELS.getView),
  chooseFolder: () => ipcRenderer.invoke(CHANNELS.chooseFolder),
  play: () => ipcRenderer.invoke(CHANNELS.play),
  next: () => ipcRenderer.invoke(CHANNELS.next),
  back: () => ipcRenderer.invoke(CHANNELS.back),
  deleteCurrent: () => ipcRenderer.invoke(CHANNELS.deleteCurrent),
  undoDelete: (id) => ipcRenderer.invoke(CHANNELS.undoDelete, id),
  restartCycle: () => ipcRenderer.invoke(CHANNELS.restartCycle),
  onView: (listener) => {
    // Pass on only the view, never the IPC event object.
    const handler = (_event: IpcRendererEvent, view: ShufflerView): void => listener(view)
    ipcRenderer.on(CHANNELS.view, handler)
    return () => {
      ipcRenderer.removeListener(CHANNELS.view, handler)
    }
  }
}

const library: LibraryApi = {
  getView: () => ipcRenderer.invoke(LIBRARY_CHANNELS.getView),
  addRoot: (path) => ipcRenderer.invoke(LIBRARY_CHANNELS.addRoot, path),
  chooseRoot: () => ipcRenderer.invoke(LIBRARY_CHANNELS.chooseRoot),
  removeRoot: (path) => ipcRenderer.invoke(LIBRARY_CHANNELS.removeRoot, path),
  chooseExcluded: () => ipcRenderer.invoke(LIBRARY_CHANNELS.chooseExcluded),
  removeExcluded: (path) => ipcRenderer.invoke(LIBRARY_CHANNELS.removeExcluded, path),
  scan: () => ipcRenderer.invoke(LIBRARY_CHANNELS.scan),
  scanRoot: (path) => ipcRenderer.invoke(LIBRARY_CHANNELS.scanRoot, path),
  cancelScan: () => ipcRenderer.invoke(LIBRARY_CHANNELS.cancelScan),
  largest: (limit) => ipcRenderer.invoke(LIBRARY_CHANNELS.largest, limit),
  recent: (limit) => ipcRenderer.invoke(LIBRARY_CHANNELS.recent, limit),
  search: (term, limit) => ipcRenderer.invoke(LIBRARY_CHANNELS.search, term, limit),
  openFile: (path) => ipcRenderer.invoke(LIBRARY_CHANNELS.openFile, path),
  showInFolder: (path) => ipcRenderer.invoke(LIBRARY_CHANNELS.showInFolder, path),
  biggestFolders: (limit) => ipcRenderer.invoke(LIBRARY_CHANNELS.biggestFolders, limit),
  duplicates: (limit) => ipcRenderer.invoke(LIBRARY_CHANNELS.duplicates, limit),
  notTouched: (days, limit) => ipcRenderer.invoke(LIBRARY_CHANNELS.notTouched, days, limit),
  checkDuplicate: (name, size) => ipcRenderer.invoke(LIBRARY_CHANNELS.checkDuplicate, name, size),
  query: (query) => ipcRenderer.invoke(LIBRARY_CHANNELS.query, query),
  onView: (listener) => {
    const handler = (_event: IpcRendererEvent, view: LibraryView): void => listener(view)
    ipcRenderer.on(LIBRARY_CHANNELS.view, handler)
    return () => {
      ipcRenderer.removeListener(LIBRARY_CHANNELS.view, handler)
    }
  }
}

const stats: StatsApi = {
  getView: () => ipcRenderer.invoke(STATS_CHANNELS.getView),
  addFavorite: (path) => ipcRenderer.invoke(STATS_CHANNELS.addFavorite, path),
  removeFavorite: (path) => ipcRenderer.invoke(STATS_CHANNELS.removeFavorite, path),
  neverPlayed: (limit, sort) => ipcRenderer.invoke(STATS_CHANNELS.neverPlayed, limit, sort),
  onView: (listener) => {
    const handler = (_event: IpcRendererEvent, view: StatsView): void => listener(view)
    ipcRenderer.on(STATS_CHANNELS.view, handler)
    return () => {
      ipcRenderer.removeListener(STATS_CHANNELS.view, handler)
    }
  }
}

const settings: SettingsApi = {
  getView: () => ipcRenderer.invoke(SETTINGS_CHANNELS.getView),
  chooseMpv: () => ipcRenderer.invoke(SETTINGS_CHANNELS.chooseMpv),
  useDefaultMpv: () => ipcRenderer.invoke(SETTINGS_CHANNELS.useDefaultMpv),
  testMpv: () => ipcRenderer.invoke(SETTINGS_CHANNELS.testMpv),
  setAppearance: (value) => ipcRenderer.invoke(SETTINGS_CHANNELS.setAppearance, value),
  clearData: (what) => ipcRenderer.invoke(SETTINGS_CHANNELS.clearData, what),
  onView: (listener) => {
    const handler = (_event: IpcRendererEvent, view: SettingsView): void => listener(view)
    ipcRenderer.on(SETTINGS_CHANNELS.view, handler)
    return () => {
      ipcRenderer.removeListener(SETTINGS_CHANNELS.view, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', { shuffler, library, stats, settings })
