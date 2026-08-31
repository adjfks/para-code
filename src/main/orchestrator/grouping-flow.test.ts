import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import type { StartTaskInput } from '../../shared/ipc'
import { FakeAgentProvider } from './fake-agent'
import { GitWorktreeManager } from './git-worktree'
import { MemoryRunRepository } from './memory-repository'
import { DefaultOrchestrator } from './orchestrator'
import type { WorktreeManager, WorktreeMetadata } from './types'

const execFileAsync = promisify(execFile)

describe('grouping flow', () => {
  it('confirms two independent groups into isolated worktrees', async () => {
    const repositoryPath = await createRepository()
    const orchestrator = createOrchestrator()
    const plan = await orchestrator.analyzePlan({
      repositoryPath,
      text: '1. 添加 greeting 函数\n2. 添加 farewell 函数',
    })

    expect(plan.groups).toHaveLength(2)
    const result = await orchestrator.confirmPlan({
      planId: plan.id,
      version: plan.version,
      idempotencyKey: 'confirm-1',
    })
    const replay = await orchestrator.confirmPlan({
      planId: plan.id,
      version: plan.version,
      idempotencyKey: 'confirm-1',
    })

    expect(result.failures).toEqual([])
    expect(result.runs).toHaveLength(2)
    expect(replay.runs.map((item) => item.run.id)).toEqual(result.runs.map((item) => item.run.id))
    expect(new Set(result.runs.map((item) => item.run.worktreePath)).size).toBe(2)
    expect(result.runs.every((item) => item.run.worktreePath.includes('.paracode/worktrees'))).toBe(
      true,
    )
    await stopAll(orchestrator)
  }, 30_000)

  it('rejects a stale plan version and a dirty workspace before creating worktrees', async () => {
    const repositoryPath = await createRepository()
    const orchestrator = createOrchestrator()
    const plan = await orchestrator.analyzePlan({
      repositoryPath,
      text: '1. 添加 greeting 函数\n2. 添加 farewell 函数',
    })
    const edited = await orchestrator.updatePlan({
      planId: plan.id,
      version: plan.version,
      requirementId: plan.requirements[1]!.id,
      targetGroupId: plan.groups[0]!.id,
    })

    await expect(
      orchestrator.confirmPlan({
        planId: plan.id,
        version: plan.version,
        idempotencyKey: 'stale',
      }),
    ).rejects.toThrow('分组方案已更新')

    await writeFile(path.join(repositoryPath, 'dirty.txt'), 'local change')
    await expect(
      orchestrator.confirmPlan({
        planId: edited.id,
        version: edited.version,
        idempotencyKey: 'dirty',
      }),
    ).rejects.toThrow('主工作区不干净')
    expect(await orchestrator.listRuns()).toEqual([])
  })

  it('retries only failed groups after a partial create failure', async () => {
    const repositoryPath = await createRepository()
    const worktrees = new FlakyWorktreeManager(new GitWorktreeManager(), 'farewell')
    const orchestrator = new DefaultOrchestrator(
      worktrees,
      new FakeAgentProvider(),
      new MemoryRunRepository(),
    )
    const plan = await orchestrator.analyzePlan({
      repositoryPath,
      text: '1. 添加 greeting 函数\n2. 添加 farewell 函数',
    })

    const first = await orchestrator.confirmPlan({
      planId: plan.id,
      version: plan.version,
      idempotencyKey: 'partial-1',
    })
    expect(first.runs).toHaveLength(1)
    expect(first.failures).toHaveLength(1)

    worktrees.failingNeedle = undefined
    const retry = await orchestrator.confirmPlan({
      planId: plan.id,
      version: plan.version,
      idempotencyKey: 'partial-2',
    })

    expect(retry.failures).toEqual([])
    expect(retry.runs).toHaveLength(2)
    expect(retry.runs.map((item) => item.run.id)).toContain(first.runs[0]?.run.id)
    await stopAll(orchestrator)
  }, 30_000)
})

function createOrchestrator(): DefaultOrchestrator {
  return new DefaultOrchestrator(
    new GitWorktreeManager(),
    new FakeAgentProvider(),
    new MemoryRunRepository(),
  )
}

async function stopAll(orchestrator: DefaultOrchestrator): Promise<void> {
  for (const run of await orchestrator.listRuns()) {
    if (
      ['creating', 'bootstrapping', 'planning', 'coding', 'testing', 'waiting_human'].includes(
        run.status,
      )
    ) {
      await orchestrator.stopTask(run.id)
    }
  }
}

class FlakyWorktreeManager implements WorktreeManager {
  constructor(
    private readonly inner: GitWorktreeManager,
    public failingNeedle?: string,
  ) {}

  async validate(input: StartTaskInput): Promise<void> {
    await this.inner.validate(input)
  }

  async create(input: StartTaskInput & { runId: string }): Promise<WorktreeMetadata> {
    if (this.failingNeedle && input.requirement.includes(this.failingNeedle)) {
      throw new Error('分支名冲突')
    }
    return this.inner.create(input)
  }
}

async function createRepository(): Promise<string> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'paracode-group-'))
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
