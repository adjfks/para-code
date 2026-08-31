import type { AgentEvent, RunSnapshot } from '../../shared/ipc'
import type { WorktreeRun } from '../../shared/ipc'
import type { RunRepository } from './types'

export class MemoryRunRepository implements RunRepository {
  private readonly snapshots = new Map<string, RunSnapshot>()

  async save(snapshot: RunSnapshot): Promise<void> {
    this.snapshots.set(snapshot.run.id, snapshot)
  }

  async get(runId: string): Promise<RunSnapshot | undefined> {
    return this.snapshots.get(runId)
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
}
