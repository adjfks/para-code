import { describe, expect, it } from 'vitest'

import type { AgentEvent, InteractionRequest } from '../../shared/ipc'
import { interactionFromEvent, providerResultForAnswer } from './interaction'

describe('interaction helpers', () => {
  it('creates a queued question from a blocking agent event', () => {
    const event = {
      id: 'evt-1',
      runId: 'run-1',
      agentSessionId: 'agent-1',
      sequence: 4,
      timestamp: '2026-08-31T00:00:00.000Z',
      type: 'question',
      payload: {
        message: '先补测试还是先改实现？',
        options: [{ id: 'tests-first', label: '先补测试' }],
        requestId: 12,
        method: 'item/tool/requestUserInput',
      },
    } satisfies AgentEvent

    expect(interactionFromEvent(event)).toMatchObject({
      id: 'interaction-evt-1',
      runId: 'run-1',
      type: 'question',
      status: 'queued',
      providerRequestId: 12,
      options: [{ id: 'tests-first', label: '先补测试' }],
    })
  })

  it('maps approval and question answers to Codex result payloads', () => {
    const approval: InteractionRequest = {
      id: 'interaction-a',
      runId: 'run-1',
      eventId: 'evt-a',
      type: 'approval',
      status: 'queued',
      title: '授权',
      message: '运行 pnpm test',
      options: [],
      createdAt: '2026-08-31T00:00:00.000Z',
    }

    expect(providerResultForAnswer(approval, { decision: 'allow' })).toEqual({
      decision: 'accept',
    })
    expect(providerResultForAnswer(approval, { decision: 'deny' })).toEqual({
      decision: 'decline',
    })
    expect(
      providerResultForAnswer(
        { ...approval, type: 'question', options: [{ id: 'q1', label: '先补测试' }] },
        { optionId: 'q1' },
      ),
    ).toEqual({ answers: { q1: { answers: ['q1'] } } })
  })
})
