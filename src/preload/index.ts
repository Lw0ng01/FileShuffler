import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
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

contextBridge.exposeInMainWorld('api', { shuffler })
