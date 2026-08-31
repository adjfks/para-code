export const IPC_CHANNELS = {
  appInfo: 'app:get-info',
  projectList: 'project:list',
  projectAdd: 'project:add',
  projectSelectPath: 'project:select-path',
  projectSetCurrent: 'project:set-current',
  projectValidate: 'project:validate',
  projectRemove: 'project:remove',
  startTask: 'run:start-task',
  stopTask: 'run:stop-task',
  runList: 'run:list',
  runGet: 'run:get',
  runEvent: 'run:event',
  providerList: 'provider:list',
  providerCreate: 'provider:create',
  providerUpdate: 'provider:update',
  providerDelete: 'provider:delete',
  providerSetDefault: 'provider:set-default',
  providerTest: 'provider:test',
  providerListModels: 'provider:list-models',
} as const

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
  arch: string
}

export type ProjectHealth = 'valid' | 'invalid' | 'unknown'

export interface ProjectSummary {
  id: string
  name: string
  repositoryPath: string
  defaultBaseRef?: string
  isCurrent: boolean
  health: ProjectHealth
  healthMessage?: string
  createdAt: string
  updatedAt: string
}

export interface ParaCodeApi {
  getAppInfo: () => Promise<AppInfo>
  listProjects: () => Promise<ProjectSummary[]>
  addProject: (repositoryPath: string) => Promise<ProjectSummary[]>
  selectProjectPath: () => Promise<string | undefined>
  setCurrentProject: (id: string) => Promise<ProjectSummary[]>
  validateProject: (id: string) => Promise<ProjectSummary[]>
  removeProject: (id: string) => Promise<ProjectSummary[]>
  startTask: (input: StartTaskInput) => Promise<RunSnapshot>
  stopTask: (runId: string) => Promise<RunSnapshot>
  listRuns: () => Promise<WorktreeRun[]>
  getRun: (runId: string) => Promise<RunSnapshot>
  onRunEvent: (listener: (event: AgentEvent) => void) => () => void
  listProviders: () => Promise<ProviderSummary[]>
  createProvider: (input: ProviderConfigInput) => Promise<ProviderSummary[]>
  updateProvider: (id: string, input: ProviderConfigInput) => Promise<ProviderSummary[]>
  deleteProvider: (id: string) => Promise<ProviderSummary[]>
  setDefaultProvider: (id: string) => Promise<ProviderSummary[]>
  testProvider: (id: string) => Promise<ProviderTestResult>
  listProviderModels: (id: string) => Promise<string[]>
}

export type ProviderSdkType = 'openai-compatible'
export type ProviderConnectionStatus = 'unknown' | 'ok' | 'failed'

export interface ProviderConfigInput {
  name: string
  baseURL: string
  apiKey?: string
  model: string
}

export interface ProviderSummary {
  id: string
  name: string
  sdkType: ProviderSdkType
  baseURL: string
  model: string
  apiKeyMasked?: string
  models: string[]
  isDefault: boolean
  connectionStatus: ProviderConnectionStatus
  lastValidatedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  models?: string[]
}

export type RunStatus =
  | 'proposed'
  | 'creating'
  | 'bootstrapping'
  | 'planning'
  | 'coding'
  | 'waiting_human'
  | 'testing'
  | 'ready_for_review'
  | 'completed'
  | 'failed'
  | 'canceled'

export type AgentEventType =
  | 'session_started'
  | 'run_status_changed'
  | 'phase_changed'
  | 'reasoning'
  | 'plan_updated'
  | 'assistant_message'
  | 'activity_started'
  | 'activity_output'
  | 'activity_completed'
  | 'progress'
  | 'tool_started'
  | 'tool_finished'
  | 'question'
  | 'approval_request'
  | 'commit_created'
  | 'test_result'
  | 'session_paused'
  | 'session_resumed'
  | 'session_completed'
  | 'session_failed'
  | 'session_canceled'

export interface StartTaskInput {
  repositoryPath: string
  requirement: string
  baseRef?: string
  providerId?: string
  model?: string
}

export interface WorktreeRun {
  id: string
  repositoryPath: string
  worktreePath: string
  branchName: string
  baseRef: string
  requirement: string
  agentSessionId?: string
  status: RunStatus
  latestMessage?: string
  createdAt: string
  updatedAt: string
}

export interface AgentEvent {
  id: string
  runId: string
  agentSessionId?: string
  sequence: number
  timestamp: string
  type: AgentEventType
  payload: AgentEventPayload
}

export interface AgentEventPayload extends Record<string, unknown> {
  method?: string
  phase?: string
  message?: string
  delta?: string
  stream?: 'agent' | 'tool' | 'plan' | 'diff' | 'stderr' | 'system'
  activityKind?: string
  summary?: string
  plan?: Array<{ step: string; status: 'pending' | 'inProgress' | 'completed' }>
  itemId?: string
  itemType?: string
  turnId?: string
  tool?: string
  command?: string
  cwd?: string
  output?: string
  path?: string
  worktreePath?: string
  branchName?: string
  baseRef?: string
  files?: string[]
  status?: string
}

export interface RunSnapshot {
  run: WorktreeRun
  events: AgentEvent[]
}
