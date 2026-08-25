import type { AgentEvent, RunSnapshot, StartTaskInput, WorktreeRun } from '../../shared/ipc'

export interface WorktreeMetadata {
  repositoryPath: string
  worktreePath: string
  branchName: string
  baseRef: string
}

export interface WorktreeManager {
  validate?(input: StartTaskInput): Promise<void>
  create(input: StartTaskInput & { runId: string }): Promise<WorktreeMetadata>
}

export interface AgentRunContext {
  runId: string
  worktreePath: string
  requirement: string
  baseRef: string
}

export interface AgentProvider {
  start(
    context: AgentRunContext,
    emit: (event: Omit<AgentEvent, 'id' | 'runId' | 'sequence' | 'timestamp'>) => void,
  ): Promise<{ agentSessionId: string }>
  stop(agentSessionId: string): Promise<void>
}

export interface RunRepository {
  save(snapshot: RunSnapshot): Promise<void>
  get(runId: string): Promise<RunSnapshot | undefined>
}

export interface Orchestrator {
  startTask(input: StartTaskInput): Promise<RunSnapshot>
  stopTask(runId: string): Promise<RunSnapshot>
  getRun(runId: string): Promise<RunSnapshot | undefined>
  onEvent(listener: (event: AgentEvent) => void): () => void
}

export type RunMutable = WorktreeRun
