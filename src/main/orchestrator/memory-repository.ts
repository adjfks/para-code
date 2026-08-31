import type { AgentEvent, InteractionRequest, RunSnapshot, WorktreeRun } from '../../shared/ipc'
import type { RunRepository } from './types'

export class MemoryRunRepository implements RunRepository {
  private readonly snapshots = new Map<string, RunSnapshot>()

  async save(snapshot: RunSnapshot): Promise<void> {
    const current = this.snapshots.get(snapshot.run.id)
    this.snapshots.set(snapshot.run.id, {
      run: snapshot.run,
      events: snapshot.events.length > 0 ? snapshot.events : (current?.events ?? []),
      interactions: mergeInteractions(current?.interactions ?? [], snapshot.interactions ?? []),
    })
  }

  async get(runId: string): Promise<RunSnapshot | undefined> {
    const snapshot = this.snapshots.get(runId)
    return snapshot ? { ...snapshot, interactions: [...snapshot.interactions] } : undefined
  }

  async appendEvent(runId: string, event: AgentEvent): Promise<RunSnapshot | undefined> {
    const snapshot = this.snapshots.get(runId)
    if (!snapshot) return undefined
    const next = { ...snapshot, events: [...snapshot.events, event] }
    this.snapshots.set(runId, next)
    return next
  }

  async listRuns(): Promise<WorktreeRun[]> {
    return [...this.snapshots.values()]
      .map((snapshot) => snapshot.run)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async listInteractions(): Promise<InteractionRequest[]> {
    return [...this.snapshots.values()]
      .flatMap((snapshot) => snapshot.interactions)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
}

function mergeInteractions(
  current: InteractionRequest[],
  incoming: InteractionRequest[],
): InteractionRequest[] {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) {
    const existing = byId.get(item.id)
    if (
      (existing?.status === 'answered' || existing?.status === 'canceled') &&
      item.status === 'queued'
    ) {
      continue
    }
    byId.set(item.id, item)
  }
  return [...byId.values()]
}
