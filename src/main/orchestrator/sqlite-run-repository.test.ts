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
