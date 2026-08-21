import { app, ipcMain } from 'electron'

import { IPC_CHANNELS, type AppInfo } from '../shared/ipc'

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  }))
}
