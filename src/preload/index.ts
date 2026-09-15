import { contextBridge } from 'electron'

// The only surface the renderer can reach (PROJECT.md §5). Add narrow, typed functions here as
// features arrive; never expose ipcRenderer itself or anything that accepts arbitrary channels,
// paths or commands. Keep the Window type in index.d.ts in sync.
const api = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
}

contextBridge.exposeInMainWorld('api', api)
