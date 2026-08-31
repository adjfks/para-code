import { randomUUID } from 'node:crypto'

import type {
  AgentEvent,
  AnswerInteractionInput,
  InteractionRequest,
  RunSnapshot,
  RunStatus,
  StartTaskInput,
  WorktreeRun,
} from '../../shared/ipc'
import { interactionFromEvent } from './interaction'
import type { AgentProvider, Orchestrator, RunRepository, WorktreeManager } from './types'

export class DefaultOrchestrator implements Orchestrator {
  private readonly listeners = new Set<(event: AgentEvent) => void>()
  private readonly eventChains = new Map<string, Promise<void>>()
  private readonly agentSessions = new Map<string, string>()
  private readonly stopTasks = new Map<string, Promise<RunSnapshot>>()
  private readonly answerTasks = new Map<string, Promise<RunSnapshot>>()
  private readonly cancelRequested = new Set<string>()
  private readonly worktreeTasks = new Map<string, Promise<unknown>>()

  constructor(
    private readonly worktrees: WorktreeManager,
    private readonly agent: AgentProvider,
    private readonly repository: RunRepository,
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
    await this.worktrees.validate?.(input)

    let snapshot: RunSnapshot = { run, events: [], interactions: [] }
    await this.repository.save(snapshot)
    snapshot = await this.updateStatus(
      snapshot,
      'creating',
      '正在检查 Git 并创建 worktree。',
      false,
    )

    setTimeout(() => {
      void this.executeTask(run.id, input)
    }, 0)
    return snapshot
  }

  private async executeTask(runId: string, input: StartTaskInput): Promise<void> {
    try {
      const worktreeTask = this.worktrees.create({ ...input, runId })
      this.worktreeTasks.set(runId, worktreeTask)
      let worktree
      try {
        worktree = await worktreeTask
      } finally {
        this.worktreeTasks.delete(runId)
      }
      let snapshot = await this.getRunOrThrow(runId)
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
      if (this.cancelRequested.has(runId) || !isActiveStatus(snapshot.run.status)) return
      await this.emitStatus(runId, 'bootstrapping', 'worktree 已创建，正在启动 Agent。')
      snapshot = await this.getRunOrThrow(runId)
      if (this.cancelRequested.has(runId) || !isActiveStatus(snapshot.run.status)) return
      const agentResult = await this.agent.start(
        {
          runId,
          worktreePath: worktree.worktreePath,
          requirement: snapshot.run.requirement,
          baseRef: worktree.baseRef,
        },
        (event) => this.enqueueEvent(runId, event),
      )
      this.agentSessions.set(runId, agentResult.agentSessionId)
      snapshot = await this.getRunOrThrow(runId)
      snapshot = {
        ...snapshot,
        run: {
          ...snapshot.run,
          agentSessionId: agentResult.agentSessionId,
          updatedAt: new Date().toISOString(),
        },
      }
      await this.repository.save(snapshot)
      if (this.cancelRequested.has(runId)) {
        await this.agent.stop(agentResult.agentSessionId)
        this.agentSessions.delete(runId)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const snapshot = await this.getRunOrThrow(runId)
      if (this.cancelRequested.has(runId) || snapshot.run.status === 'canceled') return
      await this.updateStatus(snapshot, 'failed', message)
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

    this.cancelRequested.add(runId)

    const agentSessionId = snapshot.run.agentSessionId ?? this.agentSessions.get(runId)
    if (agentSessionId) {
      await this.agent.stop(agentSessionId)
    } else {
      await this.worktreeTasks.get(runId)?.catch(() => undefined)
    }

    await this.cancelQueuedInteractions(runId)
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

  async listRuns(): Promise<WorktreeRun[]> {
    return this.repository.listRuns()
  }

  async listInteractions(): Promise<InteractionRequest[]> {
    return (await this.repository.listInteractions()).filter((item) => item.status === 'queued')
  }

  async answerInteraction(input: AnswerInteractionInput): Promise<RunSnapshot> {
    const existing = this.answerTasks.get(input.requestId)
    if (existing) return existing
    const pending = this.answerInteractionInternal(input)
    this.answerTasks.set(input.requestId, pending)
    try {
      return await pending
    } finally {
      if (this.answerTasks.get(input.requestId) === pending)
        this.answerTasks.delete(input.requestId)
    }
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async updateStatus(
    snapshot: RunSnapshot,
    status: RunStatus,
    message: string,
    publish = true,
  ): Promise<RunSnapshot> {
    const next = {
      ...snapshot,
      run: { ...snapshot.run, status, latestMessage: message, updatedAt: new Date().toISOString() },
    }
    await this.repository.save(next)
    if (publish) {
      this.enqueueEvent(snapshot.run.id, {
        type: 'run_status_changed',
        payload: {
          status,
          message,
          worktreePath: next.run.worktreePath,
          branchName: next.run.branchName,
          baseRef: next.run.baseRef,
        },
      })
    }
    return next
  }

  private async emitStatus(runId: string, status: RunStatus, message: string): Promise<void> {
    const snapshot = await this.getRunOrThrow(runId)
    await this.updateStatus(snapshot, status, message)
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
    const next = (await this.repository.appendEvent(runId, agentEvent)) ?? {
      ...snapshot,
      events: [...snapshot.events, agentEvent],
    }
    const created = interactionFromEvent(agentEvent)
    const interactions =
      created && !next.interactions.some((item) => item.id === created.id)
        ? [...next.interactions, created]
        : next.interactions
    const nextStatus =
      next.run.status === 'canceled' ? undefined : statusForEvent(event.type, event.payload)
    const finalSnapshot = {
      ...next,
      interactions,
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

  private async answerInteractionInternal(input: AnswerInteractionInput): Promise<RunSnapshot> {
    const request = (await this.repository.listInteractions()).find(
      (item) => item.id === input.requestId,
    )
    if (!request) throw new Error('交互请求不存在。')
    let snapshot = await this.getRunOrThrow(request.runId)
    if (request.status === 'answered') return snapshot
    if (request.status === 'canceled' || snapshot.run.status === 'canceled') {
      throw new Error('交互请求已取消。')
    }

    const answer = {
      text: input.text,
      optionId: input.optionId,
      decision: input.decision,
    }
    const agentSessionId = request.agentSessionId ?? snapshot.run.agentSessionId
    if (!agentSessionId) throw new Error('Agent 会话不存在。')
    await this.agent.respond(agentSessionId, request, answer)

    const answeredAt = new Date().toISOString()
    snapshot = {
      ...snapshot,
      interactions: snapshot.interactions.map((item) =>
        item.id === request.id
          ? {
              ...item,
              status: 'answered',
              idempotencyKey: input.idempotencyKey,
              answer,
              answeredAt,
            }
          : item,
      ),
    }
    await this.repository.save(snapshot)
    this.enqueueEvent(request.runId, {
      agentSessionId,
      type: 'interaction_answered',
      payload: {
        message:
          answer.text ?? answer.optionId ?? (answer.decision === 'deny' ? '已拒绝' : '已批准'),
        interactionId: request.id,
      },
    })
    await this.updateStatus(
      await this.getRunOrThrow(request.runId),
      'coding',
      '已收到回答，Agent 继续执行。',
    )
    await this.waitForEvents(request.runId)
    return this.getRunOrThrow(request.runId)
  }

  private async cancelQueuedInteractions(runId: string): Promise<void> {
    const snapshot = await this.getRunOrThrow(runId)
    if (!snapshot.interactions.some((item) => item.status === 'queued')) return
    await this.repository.save({
      ...snapshot,
      interactions: snapshot.interactions.map((item) =>
        item.status === 'queued' ? { ...item, status: 'canceled' } : item,
      ),
    })
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
    run_status_changed: undefined,
    approval_request: 'waiting_human',
    question: 'waiting_human',
    test_result: 'testing',
    session_completed: 'ready_for_review',
    session_failed: 'failed',
    session_canceled: 'canceled',
  }
  if (type === 'run_status_changed') {
    const status = payload.status
    if (typeof status === 'string' && status in STATUS_VALUES) return status as RunStatus
  }
  if (type === 'phase_changed') {
    const phase = payload.phase
    if (phase === 'planning' || phase === 'coding' || phase === 'testing') return phase
  }
  return mapping[type]
}

const STATUS_VALUES: Record<RunStatus, true> = {
  proposed: true,
  creating: true,
  bootstrapping: true,
  planning: true,
  coding: true,
  waiting_human: true,
  testing: true,
  ready_for_review: true,
  completed: true,
  failed: true,
  canceled: true,
}

function latestMessage(payload: Record<string, unknown>): string | undefined {
  return typeof payload.message === 'string' ? payload.message : undefined
}
