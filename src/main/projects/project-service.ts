import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

export interface GitProjectInfo {
  repositoryPath: string
  defaultBaseRef?: string
  isClean: boolean
}

const execFileAsync = promisify(execFile)

export class ProjectService {
  async inspect(repositoryPath: string): Promise<GitProjectInfo> {
    const inputPath = repositoryPath.trim()
    if (!inputPath) throw new Error('项目路径不能为空。')
    if (!path.isAbsolute(inputPath)) throw new Error('项目路径必须是绝对路径。')

    const root = await this.git(inputPath, ['rev-parse', '--show-toplevel'])
    const [branch, status] = await Promise.all([
      this.git(root, ['branch', '--show-current']),
      this.git(root, ['status', '--porcelain']),
    ])

    return {
      repositoryPath: root,
      defaultBaseRef: branch || undefined,
      isClean: status.trim().length === 0,
    }
  }

  private async git(repositoryPath: string, args: string[]): Promise<string> {
    try {
      const result = await execFileAsync('git', ['-C', repositoryPath, ...args], {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      })
      return result.stdout.trim()
    } catch (error) {
      throw new Error(this.gitErrorMessage(repositoryPath, error))
    }
  }

  private gitErrorMessage(repositoryPath: string, error: unknown): string {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: string }).stderr ?? '')
        : ''
    if (stderr.includes('not a git repository')) {
      return `这不是 Git 仓库：${repositoryPath}`
    }
    if (stderr.includes('Permission denied')) {
      return `没有权限访问项目：${repositoryPath}`
    }
    return `检查项目失败：${error instanceof Error ? error.message : String(error)}`
  }
}
