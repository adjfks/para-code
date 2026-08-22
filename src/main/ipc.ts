import { app, BrowserWindow, dialog, ipcMain } from 'electron'

import { IPC_CHANNELS, type AppInfo, type StartTaskInput } from '../shared/ipc'
import { CodexAppServerProvider } from './orchestrator/codex-app-server'
import { DefaultOrchestrator } from './orchestrator/orchestrator'
import { FakeAgentProvider } from './orchestrator/fake-agent'
import { GitWorktreeManager } from './orchestrator/git-worktree'
import { MemoryRunRepository } from './orchestrator/memory-repository'

const runRepository = new MemoryRunRepository()
const agentProvider =
  process.env.PARACODE_AGENT_PROVIDER === 'codex'
    ? new CodexAppServerProvider()
    : new FakeAgentProvider()
const orchestrator = new DefaultOrchestrator(new GitWorktreeManager(), agentProvider, runRepository)

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  }))

  ipcMain.handle(IPC_CHANNELS.selectProject, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择 Git 项目',
    })
    return result.canceled ? undefined : result.filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.startTask, async (_event, input: StartTaskInput) => {
    return orchestrator.startTask(input)
  })

  ipcMain.handle(IPC_CHANNELS.stopTask, async (_event, runId: string) => {
    return orchestrator.stopTask(runId)
  })

  orchestrator.onEvent((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.runEvent, event)
    }
  })
}
