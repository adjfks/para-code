export const IPC_CHANNELS = {
  appInfo: 'app:get-info',
  selectProject: 'project:select',
  startTask: 'run:start-task',
  stopTask: 'run:stop-task',
  runEvent: 'run:event',
} as const

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
  arch: string
}

export interface ParaCodeApi {
  getAppInfo: () => Promise<AppInfo>
  selectProject: () => Promise<string | undefined>
  startTask: (input: StartTaskInput) => Promise<RunSnapshot>
  stopTask: (runId: string) => Promise<RunSnapshot>
  onRunEvent: (listener: (event: AgentEvent) => void) => () => void
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
  | 'phase_changed'
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
  itemId?: string
  itemType?: string
  turnId?: string
  tool?: string
  command?: string
  cwd?: string
  output?: string
  path?: string
  files?: string[]
  status?: string
}

export interface RunSnapshot {
  run: WorktreeRun
  events: AgentEvent[]
}
