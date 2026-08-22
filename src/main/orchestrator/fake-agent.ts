import { randomUUID } from 'node:crypto'

import type { AgentProvider } from './types'

export class FakeAgentProvider implements AgentProvider {
  async start(
    context: Parameters<AgentProvider['start']>[0],
    emit: Parameters<AgentProvider['start']>[1],
  ): Promise<{ agentSessionId: string }> {
    const agentSessionId = `fake-${randomUUID()}`

    emit({
      agentSessionId,
      type: 'session_started',
      payload: { provider: 'fake', worktreePath: context.worktreePath },
    })
    await pause(40)
    emit({
      agentSessionId,
      type: 'phase_changed',
      payload: { phase: 'planning' },
    })
    await pause(40)
    emit({
      agentSessionId,
      type: 'progress',
      payload: { message: `已接收需求：${context.requirement}` },
    })
    await pause(40)
    emit({
      agentSessionId,
      type: 'phase_changed',
      payload: { phase: 'coding' },
    })
    await pause(40)
    emit({
      agentSessionId,
      type: 'phase_changed',
      payload: { phase: 'testing' },
    })
    await pause(40)
    emit({
      agentSessionId,
      type: 'test_result',
      payload: { status: 'passed', command: 'fake-test' },
    })
    await pause(40)
    emit({
      agentSessionId,
      type: 'session_completed',
      payload: { provider: 'fake', note: 'Fake Agent 已完成演示运行' },
    })

    return { agentSessionId }
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
