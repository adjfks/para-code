import { randomUUID } from 'node:crypto'

import type { AgentProvider } from './types'

interface FakeSession {
  controller: AbortController
  task: Promise<void>
}

export class FakeAgentProvider implements AgentProvider {
  private readonly sessions = new Map<string, FakeSession>()

  async start(
    context: Parameters<AgentProvider['start']>[0],
    emit: Parameters<AgentProvider['start']>[1],
  ): Promise<{ agentSessionId: string }> {
    const agentSessionId = `fake-${randomUUID()}`
    const session: FakeSession = { controller: new AbortController(), task: Promise.resolve() }
    this.sessions.set(agentSessionId, session)

    emit({
      agentSessionId,
      type: 'session_started',
      payload: { provider: 'fake', worktreePath: context.worktreePath },
    })
    session.task = this.run(context, agentSessionId, emit, session.controller.signal)
    void session.task.then(
      () => this.sessions.delete(agentSessionId),
      () => this.sessions.delete(agentSessionId),
    )

    return { agentSessionId }
  }

  async stop(agentSessionId: string): Promise<void> {
    const session = this.sessions.get(agentSessionId)
    if (!session) return
    session.controller.abort()
    await session.task
    this.sessions.delete(agentSessionId)
  }

  private async run(
    context: Parameters<AgentProvider['start']>[0],
    agentSessionId: string,
    emit: Parameters<AgentProvider['start']>[1],
    signal: AbortSignal,
  ): Promise<void> {
    if (!(await pause(350, signal))) return
    emit({ agentSessionId, type: 'phase_changed', payload: { phase: 'planning' } })
    if (!(await pause(300, signal))) return
    emit({
      agentSessionId,
      type: 'reasoning',
      payload: {
        summary: '正在分析项目结构和现有测试',
        message: '正在分析项目结构和现有测试',
      },
    })
    if (!(await pause(280, signal))) return
    emit({
      agentSessionId,
      type: 'reasoning',
      payload: {
        summary: `正在确认需求影响范围：${context.requirement}`,
        message: `正在确认需求影响范围：${context.requirement}`,
      },
    })
    if (!(await pause(280, signal))) return
    emit({
      agentSessionId,
      type: 'plan_updated',
      payload: {
        explanation: '已形成初步执行方案。',
        plan: [
          { step: '检查项目结构和现有测试', status: 'completed' },
          { step: '实现需求并补充测试', status: 'inProgress' },
          { step: '运行测试并总结变更', status: 'pending' },
        ],
      },
    })
    if (!(await pause(280, signal))) return
    emit({
      agentSessionId,
      type: 'activity_started',
      payload: {
        itemId: 'fake-inspect',
        itemType: 'commandExecution',
        activityKind: 'command',
        tool: 'commandExecution',
        command: 'pnpm test',
        status: 'running',
      },
    })
    if (!(await pause(450, signal))) return
    emit({
      agentSessionId,
      type: 'activity_output',
      payload: {
        itemId: 'fake-inspect',
        activityKind: 'command',
        command: 'pnpm test',
        output: '发现 12 个测试，正在运行…',
      },
    })
    if (!(await pause(450, signal))) return
    emit({
      agentSessionId,
      type: 'activity_completed',
      payload: {
        itemId: 'fake-inspect',
        activityKind: 'command',
        tool: 'commandExecution',
        command: 'pnpm test',
        status: 'completed',
        output: '12 passed',
      },
    })
    if (!(await pause(350, signal))) return
    emit({ agentSessionId, type: 'phase_changed', payload: { phase: 'coding' } })
    if (!(await pause(500, signal))) return
    emit({
      agentSessionId,
      type: 'activity_started',
      payload: {
        itemId: 'fake-file-change',
        itemType: 'fileChange',
        activityKind: 'fileChange',
        tool: 'fileChange',
        status: 'running',
        files: ['src/example.ts', 'src/example.test.ts'],
      },
    })
    if (!(await pause(600, signal))) return
    emit({
      agentSessionId,
      type: 'activity_completed',
      payload: {
        itemId: 'fake-file-change',
        activityKind: 'fileChange',
        tool: 'fileChange',
        status: 'completed',
        files: ['src/example.ts', 'src/example.test.ts'],
      },
    })
    if (!(await pause(350, signal))) return
    emit({
      agentSessionId,
      type: 'assistant_message',
      payload: { message: '实现已经完成，我补充了测试并准备做最后一次验证。' },
    })
    if (!(await pause(300, signal))) return
    emit({ agentSessionId, type: 'phase_changed', payload: { phase: 'testing' } })
    if (!(await pause(350, signal))) return
    emit({
      agentSessionId,
      type: 'activity_started',
      payload: {
        itemId: 'fake-final-test',
        activityKind: 'command',
        tool: 'commandExecution',
        command: 'pnpm test',
        status: 'running',
      },
    })
    if (!(await pause(650, signal))) return
    emit({
      agentSessionId,
      type: 'activity_completed',
      payload: {
        itemId: 'fake-final-test',
        activityKind: 'command',
        tool: 'commandExecution',
        command: 'pnpm test',
        status: 'completed',
        output: '12 passed',
      },
    })
    if (!(await pause(350, signal))) return
    emit({
      agentSessionId,
      type: 'test_result',
      payload: { status: 'passed', command: 'pnpm test', output: '12 passed' },
    })
    if (!(await pause(300, signal))) return
    emit({
      agentSessionId,
      type: 'plan_updated',
      payload: {
        explanation: '所有计划步骤已完成。',
        plan: [
          { step: '检查项目结构和现有测试', status: 'completed' },
          { step: '实现需求并补充测试', status: 'completed' },
          { step: '运行测试并总结变更', status: 'completed' },
        ],
      },
    })
    if (!(await pause(250, signal))) return
    emit({
      agentSessionId,
      type: 'assistant_message',
      payload: { message: '验证已通过，worktree 中的修改已经准备好供你查看。' },
    })
    if (!(await pause(250, signal))) return
    emit({
      agentSessionId,
      type: 'session_completed',
      payload: { provider: 'fake', note: 'Fake Agent 已完成演示运行' },
    })
  }
}

function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
