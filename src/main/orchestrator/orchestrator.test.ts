import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { FakeAgentProvider } from './fake-agent'
import { GitWorktreeManager } from './git-worktree'
import { MemoryRunRepository } from './memory-repository'
import { DefaultOrchestrator } from './orchestrator'

const execFileAsync = promisify(execFile)

describe('DefaultOrchestrator', () => {
  it('creates an isolated worktree and records fake agent events', async () => {
    const repositoryPath = await createRepository()
    const repository = new MemoryRunRepository()
    const orchestrator = new DefaultOrchestrator(
      new GitWorktreeManager(),
      new FakeAgentProvider(),
      repository,
    )

    const events: string[] = []
    orchestrator.onEvent((event) => events.push(event.type))
    const snapshot = await orchestrator.startTask({
      repositoryPath,
      requirement: '添加 greeting 函数',
    })

    expect(snapshot.run.status).toBe('creating')
    await waitFor(
      () =>
        repository
          .get(snapshot.run.id)
          .then(
            (value) => value?.events.some((event) => event.type === 'session_completed') ?? false,
          ),
      repository,
      snapshot.run.id,
    )
    const completed = await orchestrator.getRun(snapshot.run.id)

    expect(completed?.run.status).toBe('ready_for_review')
    expect(completed?.run.worktreePath).toContain('.paracode/worktrees')
    expect(events).toContain('session_started')
    expect(events).toContain('reasoning')
    expect(events).toContain('plan_updated')
    expect(events).toContain('activity_started')
    expect(events).toContain('activity_completed')
    expect(events).toContain('session_completed')
  }, 30_000)

  it('rejects a dirty main worktree before creating a run', async () => {
    const repositoryPath = await createRepository()
    await writeFile(path.join(repositoryPath, 'dirty.txt'), 'local change')
    const orchestrator = new DefaultOrchestrator(
      new GitWorktreeManager(),
      new FakeAgentProvider(),
      new MemoryRunRepository(),
    )

    await expect(
      orchestrator.startTask({ repositoryPath, requirement: '应该被拒绝' }),
    ).rejects.toThrow('主工作区不干净')
  })

  it('stops an active agent and preserves the isolated worktree', async () => {
    const repositoryPath = await createRepository()
    const repository = new MemoryRunRepository()
    const orchestrator = new DefaultOrchestrator(
      new GitWorktreeManager(),
      new FakeAgentProvider(),
      repository,
    )

    const events: string[] = []
    orchestrator.onEvent((event) => events.push(event.type))
    const snapshot = await orchestrator.startTask({
      repositoryPath,
      requirement: '停止这个演示任务',
    })

    await new Promise((resolve) => setTimeout(resolve, 60))
    const stopped = await orchestrator.stopTask(snapshot.run.id)
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(stopped.run.status).toBe('canceled')
    expect(stopped.run.worktreePath).toContain('.paracode/worktrees')
    expect(events).toContain('session_canceled')
    expect(events).not.toContain('session_completed')
    expect((await orchestrator.getRun(snapshot.run.id))?.run.status).toBe('canceled')
  })

  it('makes concurrent stop requests idempotent', async () => {
    const repositoryPath = await createRepository()
    const repository = new MemoryRunRepository()
    const orchestrator = new DefaultOrchestrator(
      new GitWorktreeManager(),
      new FakeAgentProvider(),
      repository,
    )

    const snapshot = await orchestrator.startTask({
      repositoryPath,
      requirement: '幂等停止任务',
    })
    const [first, second] = await Promise.all([
      orchestrator.stopTask(snapshot.run.id),
      orchestrator.stopTask(snapshot.run.id),
    ])
    const stopped = await orchestrator.getRun(snapshot.run.id)

    expect(first.run.status).toBe('canceled')
    expect(second.run.status).toBe('canceled')
    expect(stopped?.events.filter((event) => event.type === 'session_canceled')).toHaveLength(1)
  })
})

async function createRepository(): Promise<string> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'paracode-test-'))
  await execFileAsync('git', ['init', '-b', 'main', parent])
  await writeFile(path.join(parent, 'README.md'), '# fixture\n')
  await execFileAsync('git', ['-C', parent, 'add', 'README.md'])
  await execFileAsync('git', [
    '-C',
    parent,
    '-c',
    'user.email=paracode@example.com',
    '-c',
    'user.name=ParaCode Test',
    'commit',
    '-m',
    'fixture',
  ])
  return parent
}

async function waitFor(
  check: () => Promise<boolean>,
  repository: MemoryRunRepository,
  runId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  const snapshot = await repository.get(runId)
  throw new Error(
    `Timed out waiting for fake agent events: ${snapshot?.events.map((event) => event.type).join(',')}`,
  )
}
