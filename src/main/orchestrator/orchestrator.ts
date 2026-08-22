import { randomUUID } from 'node:crypto'

import type { AgentEvent, RunSnapshot, RunStatus, StartTaskInput } from '../../shared/ipc'
import type { AgentProvider, Orchestrator, RunRepository, WorktreeManager } from './types'

export class DefaultOrchestrator implements Orchestrator {
  private readonly listeners = new Set<(event: AgentEvent) => void>()
  private readonly eventChains = new Map<string, Promise<void>>()

  constructor(
    private readonly worktrees: WorktreeManager,
    private readonly agent: AgentProvider,
    private readonly repository: RunRepository & {
      appendEvent?: (runId: string, event: AgentEvent) => RunSnapshot | undefined
    },
  ) {}

  async startTask(input: StartTaskInput): Promise<RunSnapshot> {
    const now = new Date().toISOString()
    const run = {
      id: randomUUID(),
      repositoryPath: input.repositoryPath,
      worktreePath: '',
      branchName: '',
      baseRef: input.baseRef ?? '',
      requirement: input.requirement.trim(),
      status: 'proposed' as RunStatus,
      createdAt: now,
      updatedAt: now,
    }
    if (!run.requirement) throw new Error('需求不能为空。')

    let snapshot: RunSnapshot = { run, events: [] }
    await this.repository.save(snapshot)
    snapshot = await this.updateStatus(snapshot, 'creating', '正在检查 Git 并创建 worktree。')

    try {
      const worktree = await this.worktrees.create({ ...input, runId: run.id })
      snapshot = {
        ...snapshot,
        run: {
          ...snapshot.run,
          ...worktree,
          status: 'bootstrapping',
          updatedAt: new Date().toISOString(),
        },
      }
      await this.repository.save(snapshot)
      snapshot = await this.updateStatus(
        snapshot,
        'bootstrapping',
        'worktree 已创建，正在启动 Agent。',
      )
      const agentResult = await this.agent.start(
        {
          runId: run.id,
          worktreePath: worktree.worktreePath,
          requirement: run.requirement,
          baseRef: worktree.baseRef,
        },
        (event) => this.enqueueEvent(run.id, event),
      )
      await this.waitForEvents(run.id)
      snapshot = {
        ...(await this.getRunOrThrow(run.id)),
        run: {
          ...(await this.getRunOrThrow(run.id)).run,
          agentSessionId: agentResult.agentSessionId,
          updatedAt: new Date().toISOString(),
        },
      }
      await this.repository.save(snapshot)
      return snapshot
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      snapshot = await this.updateStatus(await this.getRunOrThrow(run.id), 'failed', message)
      throw error
    }
  }

  async getRun(runId: string): Promise<RunSnapshot | undefined> {
    return this.repository.get(runId)
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async updateStatus(
    snapshot: RunSnapshot,
    status: RunStatus,
    message: string,
  ): Promise<RunSnapshot> {
    const next = {
      ...snapshot,
      run: { ...snapshot.run, status, latestMessage: message, updatedAt: new Date().toISOString() },
    }
    await this.repository.save(next)
    return next
  }

  private async handleEvent(
    runId: string,
    event: Parameters<AgentProvider['start']>[1] extends (event: infer T) => void ? T : never,
  ): Promise<void> {
    const snapshot = await this.getRunOrThrow(runId)
    const agentEvent: AgentEvent = {
      id: randomUUID(),
      runId,
      agentSessionId: event.agentSessionId,
      sequence: snapshot.events.length + 1,
      timestamp: new Date().toISOString(),
      type: event.type,
      payload: event.payload,
    }
    const stored = this.repository.appendEvent?.(runId, agentEvent)
    const next = stored ?? { ...snapshot, events: [...snapshot.events, agentEvent] }
    const nextStatus = statusForEvent(event.type)
    const finalSnapshot = {
      ...next,
      run: {
        ...next.run,
        status: nextStatus ?? next.run.status,
        latestMessage: latestMessage(event.payload) ?? next.run.latestMessage,
        agentSessionId: event.agentSessionId ?? next.run.agentSessionId,
        updatedAt: new Date().toISOString(),
      },
    }
    await this.repository.save(finalSnapshot)
    for (const listener of this.listeners) listener(agentEvent)
  }

  private enqueueEvent(
    runId: string,
    event: Parameters<AgentProvider['start']>[1] extends (event: infer T) => void ? T : never,
  ): void {
    const previous = this.eventChains.get(runId) ?? Promise.resolve()
    const next = previous.then(() => this.handleEvent(runId, event))
    this.eventChains.set(runId, next)
    void next.catch(() => undefined)
  }

  private async waitForEvents(runId: string): Promise<void> {
    await this.eventChains.get(runId)
  }

  private async getRunOrThrow(runId: string): Promise<RunSnapshot> {
    const snapshot = await this.repository.get(runId)
    if (!snapshot) throw new Error(`运行记录不存在：${runId}`)
    return snapshot
  }
}

function statusForEvent(type: AgentEvent['type']): RunStatus | undefined {
  const mapping: Partial<Record<AgentEvent['type'], RunStatus>> = {
    session_started: 'planning',
    phase_changed: 'coding',
    approval_request: 'waiting_human',
    test_result: 'testing',
    session_completed: 'ready_for_review',
    session_failed: 'failed',
  }
  return mapping[type]
}

function latestMessage(payload: Record<string, unknown>): string | undefined {
  return typeof payload.message === 'string' ? payload.message : undefined
}
