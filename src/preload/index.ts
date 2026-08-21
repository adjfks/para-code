import { contextBridge, ipcRenderer } from 'electron'

import { IPC_CHANNELS, type ParaCodeApi } from '../shared/ipc'

const api: ParaCodeApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo),
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('paracode', api)
} else {
  Object.assign(window, { paracode: api })
}
