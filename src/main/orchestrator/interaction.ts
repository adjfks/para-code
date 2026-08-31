import type {
  AgentEvent,
  InteractionAnswer,
  InteractionOption,
  InteractionRequest,
} from '../../shared/ipc'

export function interactionFromEvent(event: AgentEvent): InteractionRequest | undefined {
  if (event.type !== 'question' && event.type !== 'approval_request') return undefined
  const type = event.type === 'approval_request' ? 'approval' : 'question'
  return {
    id: `interaction-${event.id}`,
    runId: event.runId,
    eventId: event.id,
    agentSessionId: event.agentSessionId,
    type,
    status: 'queued',
    title: type === 'approval' ? 'Agent 等待执行许可' : 'Agent 需要你的回答',
    message:
      payloadString(event.payload, 'message') ??
      payloadString(event.payload, 'reason') ??
      payloadString(event.payload, 'command') ??
      'Agent 需要你处理一个请求。',
    options: parseOptions(event.payload.options),
    providerRequestId: payloadId(event.payload.requestId),
    providerMethod: payloadString(event.payload, 'method'),
    createdAt: event.timestamp,
  }
}

export function providerResultForAnswer(
  request: InteractionRequest,
  answer: InteractionAnswer,
): Record<string, unknown> {
  if (request.type === 'approval') {
    return { decision: answer.decision === 'deny' ? 'decline' : 'accept' }
  }

  const questionId = answer.optionId
    ? request.options.find((option) => option.id === answer.optionId)?.id
    : request.options[0]?.id
  const text = answer.text ?? answer.optionId ?? ''
  if (questionId) {
    return { answers: { [questionId]: { answers: [text] } } }
  }
  return { answers: { reply: { answers: [text] } } }
}

function parseOptions(value: unknown): InteractionOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const option = item as Record<string, unknown>
    if (typeof option.id !== 'string' || typeof option.label !== 'string') return []
    return [{ id: option.id, label: option.label }]
  })
}

function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function payloadId(value: unknown): number | string | undefined {
  return typeof value === 'number' || typeof value === 'string' ? value : undefined
}
