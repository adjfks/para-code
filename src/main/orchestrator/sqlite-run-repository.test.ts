import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ParaCodeDatabase } from '../database/database'
import { SqliteRunRepository } from './sqlite-run-repository'
import type { RunSnapshot } from '../../shared/ipc'

const directories: string[] = []

describe('SqliteRunRepository', () => {
  let repository: SqliteRunRepository
  let database: ParaCodeDatabase

  beforeEach(async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'paracode-sqlite-'))
    directories.push(directory)
    database = await ParaCodeDatabase.open(path.join(directory, 'paracode.db'))
    repository = new SqliteRunRepository(database)
  })

  afterEach(async () => {
    database.close()
    await Promise.all(
      directories.map((directory) => rm(directory, { recursive: true, force: true })),
    )
    directories.length = 0
  })

  it('saves run snapshots and appends events exactly once', async () => {
    const snapshot = createSnapshot('run-1')
    await repository.save(snapshot)
    await repository.appendEvent('run-1', createEvent('run-1', 1))
    await repository.appendEvent('run-1', createEvent('run-1', 1))
    await repository.save({ ...snapshot, run: { ...snapshot.run, status: 'coding' } })

    const loaded = await repository.get('run-1')
    expect(loaded?.run.status).toBe('coding')
    expect(loaded?.events).toHaveLength(1)
  })

  it('lists runs by creation time and persists across reopen', async () => {
    const older = createSnapshot('older', '2026-01-01T00:00:00.000Z')
    const newer = createSnapshot('newer', '2026-01-02T00:00:00.000Z')
    await repository.save(older)
    await repository.save(newer)

    expect((await repository.listRuns()).map((run) => run.id)).toEqual(['newer', 'older'])

    const databasePath = path.join(directories.at(-1)!, 'paracode.db')
    database.close()
    const reopenedDatabase = await ParaCodeDatabase.open(databasePath)
    const reopened = new SqliteRunRepository(reopenedDatabase)
    expect(await reopened.listRuns()).toHaveLength(2)
    reopenedDatabase.close()
  })

  it('persists queued interactions and does not downgrade answered ones', async () => {
    const snapshot = createSnapshot('run-ask')
    const queued = {
      id: 'interaction-1',
      runId: 'run-ask',
      eventId: 'event-q',
      type: 'question' as const,
      status: 'queued' as const,
      title: 'Agent 需要你的回答',
      message: '先补测试还是先改实现？',
      options: [{ id: 'tests-first', label: '先补测试' }],
      createdAt: snapshot.run.createdAt,
    }
    await repository.save({ ...snapshot, interactions: [queued] })
    await repository.save({
      ...snapshot,
      interactions: [
        {
          ...queued,
          status: 'answered',
          idempotencyKey: 'key-1',
          answer: { optionId: 'tests-first' },
          answeredAt: snapshot.run.createdAt,
        },
      ],
    })
    await repository.save({ ...snapshot, interactions: [queued] })

    const loaded = await repository.get('run-ask')
    expect(loaded?.interactions).toHaveLength(1)
    expect(loaded?.interactions[0]?.status).toBe('answered')
    expect(loaded?.interactions[0]?.answer).toEqual({ optionId: 'tests-first' })
    expect((await repository.listInteractions()).map((item) => item.id)).toEqual(['interaction-1'])
  })

  it('persists grouping plans across reopen', async () => {
    const snapshot = createSnapshot('run-plan')
    await repository.save({
      ...snapshot,
      run: { ...snapshot.run, groupingPlanId: 'plan-1', groupId: 'group-1' },
    })
    await repository.savePlan({
      id: 'plan-1',
      version: 2,
      repositoryPath: '/tmp/repository',
      baseRef: 'main',
      sourceText: '1. a\n2. b',
      requirements: [{ id: 'req-1', sourceText: 'a', kind: 'feature' }],
      groups: [{ id: 'group-1', name: '分组 A', requirementIds: ['req-1'] }],
      unassigned: [],
      groupRuns: [{ groupId: 'group-1', runId: 'run-plan', status: 'creating' }],
      status: 'confirmed',
      confirmKey: 'key-1',
      createdAt: snapshot.run.createdAt,
      updatedAt: snapshot.run.createdAt,
    })

    const loaded = await repository.getPlan('plan-1')
    expect(loaded?.version).toBe(2)
    expect(loaded?.groups[0]?.name).toBe('分组 A')
    expect((await repository.get('run-plan'))?.run.groupingPlanId).toBe('plan-1')
  })

  it('rejects an event for an unknown run', async () => {
    await expect(repository.appendEvent('missing', createEvent('missing', 1))).rejects.toThrow(
      '运行记录不存在',
    )
  })

  it('records a recovery event for an interrupted active run', async () => {
    const active = createSnapshot('active')
    await repository.save(active)

    const event = await repository.appendRecoveryEvent(active.run, '应用重启导致任务中断。')
    await repository.save({
      ...active,
      run: {
        ...active.run,
        status: 'failed',
        latestMessage: '应用重启导致任务中断。',
        updatedAt: event?.timestamp ?? active.run.updatedAt,
      },
    })

    const loaded = await repository.get('active')
    expect(event?.type).toBe('session_failed')
    expect(loaded?.run.status).toBe('failed')
    expect(loaded?.run.latestMessage).toBe('应用重启导致任务中断。')
    expect(loaded?.events).toHaveLength(1)
  })
})

function createSnapshot(id: string, createdAt = new Date().toISOString()): RunSnapshot {
  return {
    run: {
      id,
      repositoryPath: '/tmp/repository',
      worktreePath: '/tmp/worktree',
      branchName: 'main',
      baseRef: 'main',
      requirement: '测试任务',
      status: 'planning',
      createdAt,
      updatedAt: createdAt,
    },
    events: [],
    interactions: [],
  }
}

function createEvent(runId: string, sequence: number) {
  return {
    id: `event-${sequence}`,
    runId,
    sequence,
    timestamp: new Date().toISOString(),
    type: 'reasoning' as const,
    payload: { message: '思考中' },
  }
}
