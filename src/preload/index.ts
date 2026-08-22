import { contextBridge, ipcRenderer } from 'electron'

import { IPC_CHANNELS, type ParaCodeApi } from '../shared/ipc'

const api: ParaCodeApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo),
  selectProject: () => ipcRenderer.invoke(IPC_CHANNELS.selectProject),
  startTask: (input) => ipcRenderer.invoke(IPC_CHANNELS.startTask, input),
  stopTask: (runId) => ipcRenderer.invoke(IPC_CHANNELS.stopTask, runId),
  onRunEvent: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: Parameters<typeof listener>[0],
    ) => {
      listener(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.runEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.runEvent, handler)
  },
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('paracode', api)
} else {
  Object.assign(window, { paracode: api })
}
