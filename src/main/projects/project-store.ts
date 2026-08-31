import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ProjectSummary } from '../../shared/ipc'
import type { ProjectService } from './project-service'

interface StoredProject {
  id: string
  name: string
  repositoryPath: string
  defaultBaseRef?: string
  isCurrent: boolean
  health: ProjectSummary['health']
  healthMessage?: string
  createdAt: string
  updatedAt: string
}

export class ProjectStore {
  private projects: StoredProject[] = []

  constructor(
    private readonly configPath: string,
    private readonly projectService: ProjectService,
  ) {}

  async load(): Promise<void> {
    this.projects = await readJson<StoredProject[]>(this.configPath, [])
    this.normalizeCurrent()
  }

  list(): ProjectSummary[] {
    return this.projects.map((project) => this.toSummary(project))
  }

  get(id: string): ProjectSummary | undefined {
    const project = this.projects.find((item) => item.id === id)
    return project ? this.toSummary(project) : undefined
  }

  getCurrent(): ProjectSummary | undefined {
    const project = this.projects.find((item) => item.isCurrent)
    return project ? this.toSummary(project) : undefined
  }

  async add(repositoryPath: string): Promise<ProjectSummary[]> {
    const info = await this.projectService.inspect(repositoryPath)
    const existing = this.projects.find(
      (project) => project.repositoryPath.toLowerCase() === info.repositoryPath.toLowerCase(),
    )
    if (existing) {
      existing.defaultBaseRef = info.defaultBaseRef
      existing.health = 'valid'
      existing.healthMessage = undefined
      existing.updatedAt = new Date().toISOString()
      this.projects.forEach((project) => {
        project.isCurrent = project.id === existing.id
      })
      await this.save()
      return this.list()
    }

    const now = new Date().toISOString()
    const project: StoredProject = {
      id: randomUUID(),
      name: path.basename(info.repositoryPath),
      repositoryPath: info.repositoryPath,
      defaultBaseRef: info.defaultBaseRef,
      isCurrent: true,
      health: 'valid',
      createdAt: now,
      updatedAt: now,
    }
    this.projects.forEach((item) => {
      item.isCurrent = false
    })
    this.projects.push(project)
    await this.save()
    return this.list()
  }

  async setCurrent(id: string): Promise<ProjectSummary[]> {
    this.requireStored(id)
    this.projects.forEach((project) => {
      project.isCurrent = project.id === id
    })
    await this.save()
    return this.list()
  }

  async validate(id: string): Promise<ProjectSummary[]> {
    const project = this.requireStored(id)
    try {
      const info = await this.projectService.inspect(project.repositoryPath)
      project.repositoryPath = info.repositoryPath
      project.defaultBaseRef = info.defaultBaseRef
      project.health = 'valid'
      project.healthMessage = undefined
    } catch (error) {
      project.health = 'invalid'
      project.healthMessage = error instanceof Error ? error.message : String(error)
    }
    project.updatedAt = new Date().toISOString()
    await this.save()
    return this.list()
  }

  async remove(id: string): Promise<ProjectSummary[]> {
    this.requireStored(id)
    this.projects = this.projects.filter((project) => project.id !== id)
    if (this.projects.length > 0 && !this.projects.some((project) => project.isCurrent)) {
      this.projects[0].isCurrent = true
    }
    await this.save()
    return this.list()
  }

  getRepositoryPath(id: string): string {
    return this.requireStored(id).repositoryPath
  }

  private requireStored(id: string): StoredProject {
    const project = this.projects.find((item) => item.id === id)
    if (!project) throw new Error('项目不存在。')
    return project
  }

  private normalizeCurrent(): void {
    if (this.projects.some((project) => project.isCurrent)) return
    if (this.projects[0]) this.projects[0].isCurrent = true
  }

  private toSummary(project: StoredProject): ProjectSummary {
    const { id, ...summary } = project
    return { id, ...summary }
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true })
    await writeJsonAtomic(this.configPath, this.projects)
  }
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(filePath, 'utf8')
    return JSON.parse(content) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw new Error(`读取项目配置失败：${path.basename(filePath)}`)
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, filePath)
  } catch {
    await rm(temporaryPath, { force: true })
    throw new Error(`保存项目配置失败：${path.basename(filePath)}`)
  }
}
