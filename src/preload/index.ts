import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { LIBRARY_CHANNELS, type LibraryApi, type LibraryView } from '../shared/library'
import { CHANNELS, type ShufflerApi, type ShufflerView } from '../shared/shuffler'

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
  scan: () => ipcRenderer.invoke(LIBRARY_CHANNELS.scan),
  cancelScan: () => ipcRenderer.invoke(LIBRARY_CHANNELS.cancelScan),
  largest: (limit) => ipcRenderer.invoke(LIBRARY_CHANNELS.largest, limit),
  recent: (limit) => ipcRenderer.invoke(LIBRARY_CHANNELS.recent, limit),
  search: (term, limit) => ipcRenderer.invoke(LIBRARY_CHANNELS.search, term, limit),
  openFile: (path) => ipcRenderer.invoke(LIBRARY_CHANNELS.openFile, path),
  showInFolder: (path) => ipcRenderer.invoke(LIBRARY_CHANNELS.showInFolder, path),
  onView: (listener) => {
    const handler = (_event: IpcRendererEvent, view: LibraryView): void => listener(view)
    ipcRenderer.on(LIBRARY_CHANNELS.view, handler)
    return () => {
      ipcRenderer.removeListener(LIBRARY_CHANNELS.view, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', { shuffler, library })
