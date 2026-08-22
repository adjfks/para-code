import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import type { StartTaskInput } from '../../shared/ipc'
import type { WorktreeManager, WorktreeMetadata } from './types'

const execFileAsync = promisify(execFile)

export class GitWorktreeManager implements WorktreeManager {
  async create(input: StartTaskInput & { runId: string }): Promise<WorktreeMetadata> {
    const repositoryPath = await git(input.repositoryPath, ['rev-parse', '--show-toplevel'])
    const status = await git(repositoryPath, ['status', '--porcelain'])
    if (status.trim()) {
      throw new Error('主工作区不干净，请先提交或暂存当前修改后再创建执行环境。')
    }

    const baseRef = input.baseRef ?? (await git(repositoryPath, ['branch', '--show-current']))
    if (!baseRef.trim()) throw new Error('无法确定当前 Git 分支。')

    const slug = slugify(input.requirement)
    const branchName = `paracode/${input.runId}/${slug}`
    const worktreePath = path.join(
      path.dirname(repositoryPath),
      '.paracode',
      'worktrees',
      input.runId,
      slug,
    )
    await mkdir(path.dirname(worktreePath), { recursive: true })

    try {
      await git(repositoryPath, ['worktree', 'add', '-b', branchName, worktreePath, baseRef])
    } catch (error) {
      await rm(worktreePath, { recursive: true, force: true })
      throw error
    }

    return { repositoryPath, worktreePath, branchName, baseRef }
  }
}

async function git(repositoryPath: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', ['-C', repositoryPath, ...args], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    return result.stdout.trim()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Git 命令失败：git -C ${repositoryPath} ${args.join(' ')}\n${message}`)
  }
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'task'
}
