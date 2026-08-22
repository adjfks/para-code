import { randomUUID } from 'node:crypto'

import type { AgentEvent, RunSnapshot, RunStatus, StartTaskInput } from '../../shared/ipc'
import type { AgentProvider, Orchestrator, RunRepository, WorktreeManager } from './types'

export class DefaultOrchestrator implements Orchestrator {
  private readonly listeners = new Set<(event: AgentEvent) => void>()
  private readonly eventChains = new Map<string, Promise<void>>()
  private readonly agentSessions = new Map<string, string>()
  private readonly stopTasks = new Map<string, Promise<RunSnapshot>>()

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
      this.agentSessions.set(run.id, agentResult.agentSessionId)
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
      if (!isActiveStatus(snapshot.run.status)) this.agentSessions.delete(run.id)
      return snapshot
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      snapshot = await this.updateStatus(await this.getRunOrThrow(run.id), 'failed', message)
      throw error
    }
  }

  async stopTask(runId: string): Promise<RunSnapshot> {
    const existing = this.stopTasks.get(runId)
    if (existing) return existing

    const pending = this.stopTaskInternal(runId)
    this.stopTasks.set(runId, pending)
    try {
      return await pending
    } finally {
      if (this.stopTasks.get(runId) === pending) this.stopTasks.delete(runId)
    }
  }

  private async stopTaskInternal(runId: string): Promise<RunSnapshot> {
    const snapshot = await this.getRunOrThrow(runId)
    if (!isActiveStatus(snapshot.run.status)) return snapshot

    const agentSessionId = snapshot.run.agentSessionId ?? this.agentSessions.get(runId)
    if (agentSessionId) await this.agent.stop(agentSessionId)

    this.enqueueEvent(runId, {
      agentSessionId,
      type: 'session_canceled',
      payload: { message: '任务已停止，当前 worktree 修改已保留。' },
    })
    await this.waitForEvents(runId)
    this.agentSessions.delete(runId)
    return this.getRunOrThrow(runId)
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
    const nextStatus =
      next.run.status === 'canceled' ? undefined : statusForEvent(event.type, event.payload)
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
    if (['session_completed', 'session_failed', 'session_canceled'].includes(event.type)) {
      this.agentSessions.delete(runId)
    }
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

function isActiveStatus(status: RunStatus): boolean {
  return ['creating', 'bootstrapping', 'planning', 'coding', 'testing', 'waiting_human'].includes(
    status,
  )
}

function statusForEvent(
  type: AgentEvent['type'],
  payload: Record<string, unknown> = {},
): RunStatus | undefined {
  const mapping: Partial<Record<AgentEvent['type'], RunStatus>> = {
    session_started: 'planning',
    approval_request: 'waiting_human',
    test_result: 'testing',
    session_completed: 'ready_for_review',
    session_failed: 'failed',
    session_canceled: 'canceled',
  }
  if (type === 'phase_changed') {
    const phase = payload.phase
    if (phase === 'planning' || phase === 'coding' || phase === 'testing') return phase
  }
  return mapping[type]
}

function latestMessage(payload: Record<string, unknown>): string | undefined {
  return typeof payload.message === 'string' ? payload.message : undefined
}
