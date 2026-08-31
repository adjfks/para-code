import { contextBridge, ipcRenderer } from 'electron'

import { IPC_CHANNELS, type ParaCodeApi } from '../shared/ipc'

const api: ParaCodeApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo),
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.projectList),
  addProject: (repositoryPath) => ipcRenderer.invoke(IPC_CHANNELS.projectAdd, repositoryPath),
  selectProjectPath: () => ipcRenderer.invoke(IPC_CHANNELS.projectSelectPath),
  setCurrentProject: (id) => ipcRenderer.invoke(IPC_CHANNELS.projectSetCurrent, id),
  validateProject: (id) => ipcRenderer.invoke(IPC_CHANNELS.projectValidate, id),
  removeProject: (id) => ipcRenderer.invoke(IPC_CHANNELS.projectRemove, id),
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
  listProviders: () => ipcRenderer.invoke(IPC_CHANNELS.providerList),
  createProvider: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerCreate, input),
  updateProvider: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.providerUpdate, id, input),
  deleteProvider: (id) => ipcRenderer.invoke(IPC_CHANNELS.providerDelete, id),
  setDefaultProvider: (id) => ipcRenderer.invoke(IPC_CHANNELS.providerSetDefault, id),
  testProvider: (id) => ipcRenderer.invoke(IPC_CHANNELS.providerTest, id),
  listProviderModels: (id) => ipcRenderer.invoke(IPC_CHANNELS.providerListModels, id),
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('paracode', api)
} else {
  Object.assign(window, { paracode: api })
}
