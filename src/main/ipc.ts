import { app, BrowserWindow, dialog, ipcMain } from 'electron'

import path from 'node:path'

import {
  IPC_CHANNELS,
  type AppInfo,
  type ProjectSummary,
  type ProviderConfigInput,
  type ProviderSummary,
  type ProviderTestResult,
  type StartTaskInput,
} from '../shared/ipc'
import { CodexAppServerProvider } from './orchestrator/codex-app-server'
import { DefaultOrchestrator } from './orchestrator/orchestrator'
import { FakeAgentProvider } from './orchestrator/fake-agent'
import { GitWorktreeManager } from './orchestrator/git-worktree'
import { MemoryRunRepository } from './orchestrator/memory-repository'
import { ProjectService } from './projects/project-service'
import { ProjectStore } from './projects/project-store'
import { listOpenAICompatibleModels } from './providers/openai-compatible'
import { ProviderStore } from './providers/provider-store'

const runRepository = new MemoryRunRepository()
const agentProvider =
  process.env.PARACODE_AGENT_PROVIDER === 'codex'
    ? new CodexAppServerProvider()
    : new FakeAgentProvider()
const orchestrator = new DefaultOrchestrator(new GitWorktreeManager(), agentProvider, runRepository)
const providerStore = new ProviderStore(
  path.join(app.getPath('userData'), 'providers.json'),
  path.join(app.getPath('userData'), 'providers.secrets.json'),
)
const projectStore = new ProjectStore(
  path.join(app.getPath('userData'), 'projects.json'),
  new ProjectService(),
)

export function registerIpcHandlers(): void {
  void providerStore.load()
  void projectStore.load().catch((error) => {
    console.error('加载项目配置失败：', error)
  })

  ipcMain.handle(IPC_CHANNELS.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  }))

  ipcMain.handle(IPC_CHANNELS.projectList, async (): Promise<ProjectSummary[]> =>
    projectStore.list(),
  )

  ipcMain.handle(IPC_CHANNELS.projectAdd, async (_event, repositoryPath: string) =>
    projectStore.add(repositoryPath),
  )

  ipcMain.handle(IPC_CHANNELS.projectSelectPath, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '添加 Git 项目',
    })
    return result.canceled ? undefined : result.filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.projectSetCurrent, async (_event, id: string) =>
    projectStore.setCurrent(id),
  )

  ipcMain.handle(IPC_CHANNELS.projectValidate, async (_event, id: string) =>
    projectStore.validate(id),
  )

  ipcMain.handle(IPC_CHANNELS.projectRemove, async (_event, id: string) => projectStore.remove(id))

  ipcMain.handle(IPC_CHANNELS.startTask, async (_event, input: StartTaskInput) => {
    validateTaskProvider(input)
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

  ipcMain.handle(IPC_CHANNELS.providerList, async () => providerStore.list())

  ipcMain.handle(
    IPC_CHANNELS.providerCreate,
    async (_event, input: ProviderConfigInput): Promise<ProviderSummary[]> =>
      providerStore.create(input),
  )

  ipcMain.handle(
    IPC_CHANNELS.providerUpdate,
    async (_event, id: string, input: ProviderConfigInput): Promise<ProviderSummary[]> =>
      providerStore.update(id, input),
  )

  ipcMain.handle(
    IPC_CHANNELS.providerDelete,
    async (_event, id: string): Promise<ProviderSummary[]> => providerStore.delete(id),
  )

  ipcMain.handle(
    IPC_CHANNELS.providerSetDefault,
    async (_event, id: string): Promise<ProviderSummary[]> => providerStore.setDefault(id),
  )

  ipcMain.handle(
    IPC_CHANNELS.providerTest,
    async (_event, id: string): Promise<ProviderTestResult> => {
      const provider = providerStore.get(id)
      if (!provider) throw new Error('Provider 不存在。')
      const result = await listOpenAICompatibleModels({
        baseURL: provider.baseURL,
        apiKey: providerStore.getApiKey(id),
      })
      await providerStore.updateConnection(id, result.ok ? 'ok' : 'failed', result.models)
      return result
    },
  )

  ipcMain.handle(IPC_CHANNELS.providerListModels, async (_event, id: string): Promise<string[]> => {
    const provider = providerStore.get(id)
    if (!provider) throw new Error('Provider 不存在。')
    const result = await listOpenAICompatibleModels({
      baseURL: provider.baseURL,
      apiKey: providerStore.getApiKey(id),
    })
    if (!result.ok) throw new Error(result.message)
    await providerStore.updateModels(id, result.models ?? [])
    return result.models ?? []
  })
}

function validateTaskProvider(input: StartTaskInput): void {
  if (!input.providerId && !input.model) return
  if (!input.providerId) throw new Error('请选择 AI Provider。')
  if (!input.model) throw new Error('请选择模型。')
  const provider = providerStore.get(input.providerId)
  if (!provider) throw new Error('所选 AI Provider 不存在。')
  if (!provider.models.includes(input.model)) {
    throw new Error('所选模型不存在，请刷新 Provider 模型列表。')
  }
}
