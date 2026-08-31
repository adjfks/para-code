import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectStore } from './project-store'
import type { GitProjectInfo, ProjectService } from './project-service'

const directories: string[] = []

describe('ProjectStore', () => {
  let configPath: string
  let store: ProjectStore
  let projectService: ProjectService

  beforeEach(async () => {
    const directory = await setup()
    configPath = path.join(directory, 'projects.json')
    const inspect = vi.fn(async (repositoryPath: string): Promise<GitProjectInfo> => ({
      repositoryPath,
      defaultBaseRef: 'main',
      isClean: true,
    }))
    projectService = { inspect } as unknown as ProjectService
    store = new ProjectStore(configPath, projectService)
  })

  afterEach(async () => {
    await Promise.all(
      directories.map((directory) => rm(directory, { recursive: true, force: true })),
    )
    directories.length = 0
  })

  it('adds a project, persists it, and marks it current', async () => {
    const projects = await store.add('/tmp/demo-project')

    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({
      name: 'demo-project',
      repositoryPath: '/tmp/demo-project',
      defaultBaseRef: 'main',
      isCurrent: true,
      health: 'valid',
    })
    expect(JSON.parse(await readFile(configPath, 'utf8'))[0].id).toBe(projects[0].id)
  })

  it('reuses an existing project instead of creating a duplicate', async () => {
    await store.add('/tmp/demo-project')
    const projects = await store.add('/tmp/DEMO-PROJECT')

    expect(projects).toHaveLength(1)
    expect(projects[0].isCurrent).toBe(true)
  })

  it('keeps one current project and promotes the first after removal', async () => {
    const firstBatch = await store.add('/tmp/first')
    const secondBatch = await store.add('/tmp/second')
    const first = firstBatch.find((project) => project.repositoryPath === '/tmp/first')!
    const second = secondBatch.find((project) => project.repositoryPath === '/tmp/second')!
    const projectsAfterSwitch = await store.setCurrent(second.id)
    expect(projectsAfterSwitch.find((project) => project.isCurrent)?.id).toBe(second.id)

    const projectsAfterRemoval = await store.remove(second.id)
    expect(projectsAfterRemoval).toHaveLength(1)
    expect(projectsAfterRemoval[0].id).toBe(first.id)
    expect(projectsAfterRemoval[0].isCurrent).toBe(true)
  })

  it('records validation failures without removing the project', async () => {
    const [project] = await store.add('/tmp/demo-project')
    ;(projectService.inspect as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('not a git repository'),
    )

    const projects = await store.validate(project.id)

    expect(projects[0]).toMatchObject({
      health: 'invalid',
      healthMessage: 'not a git repository',
    })
  })
})

async function setup(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'paracode-project-'))
  directories.push(directory)
  return directory
}
