import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

import type { AgentEvent, InteractionAnswer, InteractionRequest } from '../../shared/ipc'
import { providerResultForAnswer } from './interaction'
import type { AgentProvider, AgentRunContext } from './types'

interface JsonRpcResponse {
  id?: number
  result?: Record<string, unknown>
  error?: { message?: string }
}

interface JsonRpcServerRequest {
  id: number | string
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcNotification {
  method?: string
  params?: Record<string, unknown>
}

export class CodexAppServerProvider implements AgentProvider {
  private readonly command: string
  private readonly sessions = new Map<string, ActiveCodexSession>()

  constructor(command = process.env.PARACODE_CODEX_BIN ?? 'codex') {
    this.command = command
  }

  async start(
    context: AgentRunContext,
    emit: Parameters<AgentProvider['start']>[1],
  ): Promise<{ agentSessionId: string }> {
    const processHandle = spawn(this.command, ['app-server', '--stdio'], {
      cwd: context.worktreePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const client = new JsonRpcClient(processHandle)
    const agentSessionId = `codex-${randomUUID()}`
    const session: ActiveCodexSession = {
      client,
      processHandle,
      threadId: undefined,
      turnId: undefined,
      stopping: false,
    }
    this.sessions.set(agentSessionId, session)

    client.onNotification((notification) => {
      updateTurnId(session, notification)
      if (session.stopping) return
      const event = mapCodexNotification(notification, agentSessionId)
      if (event) emit(event)
    })
    client.onServerRequest((request) => {
      if (session.stopping) return
      const event = mapCodexNotification(
        { method: request.method, params: request.params },
        agentSessionId,
        request.id,
      )
      if (event) emit(event)
    })
    processHandle.stderr.on('data', (chunk: Buffer) => {
      if (session.stopping) return
      const message = chunk.toString().trim()
      if (message) {
        emit({
          agentSessionId,
          type: 'progress',
          payload: { stream: 'stderr', message },
        })
      }
    })

    try {
      await client.request('initialize', {
        clientInfo: { name: 'paracode', version: '0.1.0' },
        capabilities: {},
      })
      client.notify('initialized', {})
      const thread = await client.request('thread/start', {
        cwd: context.worktreePath,
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
        personality: 'pragmatic',
        serviceName: 'paracode',
      })
      const threadId = readString(thread.result?.thread, 'id')
      session.threadId = threadId

      emit({
        agentSessionId,
        type: 'session_started',
        payload: { provider: 'codex-app-server', threadId },
      })

      const turn = await client.request('turn/start', {
        threadId,
        cwd: context.worktreePath,
        summary: 'detailed',
        input: [
          {
            type: 'text',
            text: [
              '你正在 ParaCode 的独立 worktree 中工作。',
              `需求：${context.requirement}`,
              `基准引用：${context.baseRef}`,
              '只修改当前 worktree 内的文件，完成后运行相关测试，并总结变更。',
            ].join('\n'),
          },
        ],
      })
      session.turnId = readString(turn.result?.turn, 'id')

      return { agentSessionId }
    } catch (error) {
      session.stopping = true
      this.sessions.delete(agentSessionId)
      if (!processHandle.killed) processHandle.kill()
      throw error
    }
  }

  async respond(
    agentSessionId: string,
    request: InteractionRequest,
    answer: InteractionAnswer,
  ): Promise<void> {
    const session = this.sessions.get(agentSessionId)
    if (!session) throw new Error('Codex 会话不存在。')
    if (request.providerRequestId === undefined) {
      throw new Error('交互请求缺少 Codex request id，无法恢复执行。')
    }
    session.client.respond(request.providerRequestId, providerResultForAnswer(request, answer))
  }

  async stop(agentSessionId: string): Promise<void> {
    const session = this.sessions.get(agentSessionId)
    if (!session) return
    session.stopping = true
    try {
      if (session.threadId && session.turnId) {
        await withTimeout(
          session.client.request('turn/interrupt', {
            threadId: session.threadId,
            turnId: session.turnId,
          }),
          3_000,
        )
      }
    } catch {
      // The process may already have exited; killing it below is still safe.
    } finally {
      this.disposeSession(agentSessionId, session)
    }
  }

  private disposeSession(agentSessionId: string, session: ActiveCodexSession): void {
    session.stopping = true
    if (!session.processHandle.killed) session.processHandle.kill()
    this.sessions.delete(agentSessionId)
  }
}

interface ActiveCodexSession {
  client: JsonRpcClient
  processHandle: ChildProcessWithoutNullStreams
  threadId?: string
  turnId?: string
  stopping: boolean
}

function updateTurnId(session: ActiveCodexSession, notification: JsonRpcNotification): void {
  if (notification.method !== 'turn/started') return
  const turn = asRecord(notification.params?.turn)
  const turnId = asString(turn?.id) ?? asString(notification.params?.turnId)
  if (turnId) session.turnId = turnId
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Codex interrupt timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

class JsonRpcClient {
  private nextId = 1
  private readonly pending = new Map<
    number,
    {
      resolve: (response: JsonRpcResponse) => void
      reject: (error: Error) => void
    }
  >()
  private notificationListener?: (notification: JsonRpcNotification) => void
  private serverRequestListener?: (request: JsonRpcServerRequest) => void

  constructor(private readonly processHandle: ChildProcessWithoutNullStreams) {
    const lines = createInterface({ input: processHandle.stdout })
    lines.on('line', (line) => this.handleLine(line))
    processHandle.on('error', (error) => {
      for (const request of this.pending.values()) request.reject(error)
      this.pending.clear()
    })
    processHandle.on('exit', (code, signal) => {
      const error = new Error(`Codex app-server exited (${code ?? 'null'}, ${signal ?? 'unknown'})`)
      for (const request of this.pending.values()) request.reject(error)
      this.pending.clear()
    })
  }

  request(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write({ id, method, params })
    })
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.write({ method, params })
  }

  respond(id: number | string, result: Record<string, unknown>): void {
    this.write({ id, result })
  }

  onNotification(listener: (notification: JsonRpcNotification) => void): void {
    this.notificationListener = listener
  }

  onServerRequest(listener: (request: JsonRpcServerRequest) => void): void {
    this.serverRequestListener = listener
  }

  private write(message: Record<string, unknown>): void {
    this.processHandle.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleLine(line: string): void {
    if (!line.trim()) return
    let message: JsonRpcResponse & JsonRpcNotification
    try {
      message = JSON.parse(line) as JsonRpcResponse & JsonRpcNotification
    } catch {
      return
    }
    if (
      (typeof message.id === 'number' || typeof message.id === 'string') &&
      typeof message.method === 'string'
    ) {
      this.serverRequestListener?.({
        id: message.id,
        method: message.method,
        params: message.params,
      })
      return
    }
    if (typeof message.id === 'number') {
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message ?? 'Codex request failed'))
      else request.resolve(message)
      return
    }
    this.notificationListener?.(message)
  }
}

function mapCodexNotification(
  notification: JsonRpcNotification,
  agentSessionId: string,
  requestId?: number | string,
): Omit<AgentEvent, 'id' | 'runId' | 'sequence' | 'timestamp'> | undefined {
  const method = notification.method
  if (!method) return undefined
  const payload = notification.params ?? {}
  const item = asRecord(payload.item)
  const turn = asRecord(payload.turn)
  const itemType = asString(item?.type)
  const itemId = asString(item?.id) ?? asString(payload.itemId)
  const turnId = asString(turn?.id) ?? asString(payload.turnId)
  const commonPayload = {
    ...payload,
    ...(requestId === undefined ? {} : { requestId }),
    ...(itemId ? { itemId } : {}),
    ...(turnId ? { turnId } : {}),
    ...(itemType ? { itemType } : {}),
  }

  if (method === 'turn/started') {
    return {
      agentSessionId,
      type: 'phase_changed',
      payload: { ...commonPayload, phase: 'planning' },
    }
  }
  if (method === 'turn/completed') {
    const status = asString(turn?.status) ?? asString(payload.status)
    if (status === 'failed')
      return { agentSessionId, type: 'session_failed', payload: commonPayload }
    if (status === 'interrupted') {
      return { agentSessionId, type: 'session_paused', payload: commonPayload }
    }
    return { agentSessionId, type: 'session_completed', payload: commonPayload }
  }
  if (method.includes('requestApproval')) {
    return { agentSessionId, type: 'approval_request', payload: { ...commonPayload, method } }
  }
  if (method.includes('requestUserInput') || method === 'mcpServer/elicitation/request') {
    return { agentSessionId, type: 'question', payload: { ...commonPayload, method } }
  }
  if (method === 'item/agentMessage/delta') {
    const delta = asString(payload.delta) ?? asString(payload.text)
    return {
      agentSessionId,
      type: 'assistant_message',
      payload: { ...commonPayload, ...(delta ? { delta, message: delta } : {}) },
    }
  }
  if (method === 'item/commandExecution/outputDelta') {
    const delta = asString(payload.delta) ?? asString(payload.output)
    return {
      agentSessionId,
      type: 'activity_output',
      payload: { ...commonPayload, activityKind: 'command', ...(delta ? { output: delta } : {}) },
    }
  }
  if (method === 'item/fileChange/outputDelta' || method === 'item/fileChange/patchUpdated') {
    const delta = asString(payload.delta) ?? asString(payload.output)
    return {
      agentSessionId,
      type: 'activity_output',
      payload: {
        ...commonPayload,
        activityKind: 'fileChange',
        ...(delta ? { output: delta } : {}),
      },
    }
  }
  if (method === 'item/mcpToolCall/progress') {
    const delta = asString(payload.message) ?? asString(payload.output) ?? asString(payload.delta)
    return {
      agentSessionId,
      type: 'activity_output',
      payload: {
        ...commonPayload,
        activityKind: 'mcpToolCall',
        ...(delta ? { output: delta } : {}),
      },
    }
  }
  if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
    const delta = asString(payload.delta)
    return {
      agentSessionId,
      type: 'reasoning',
      payload: { ...commonPayload, ...(delta ? { delta, message: delta, summary: delta } : {}) },
    }
  }
  if (method === 'item/reasoning/summaryPartAdded') {
    return {
      agentSessionId,
      type: 'reasoning',
      payload: { ...commonPayload, message: '分析摘要已更新。' },
    }
  }
  if (method === 'item/plan/delta') {
    const delta = asString(payload.delta)
    return {
      agentSessionId,
      type: 'plan_updated',
      payload: { ...commonPayload, ...(delta ? { delta, message: delta } : {}) },
    }
  }
  if (method === 'turn/plan/updated') {
    return {
      agentSessionId,
      type: 'plan_updated',
      payload: {
        ...commonPayload,
        message: asString(payload.explanation),
        plan: Array.isArray(payload.plan) ? payload.plan : undefined,
      },
    }
  }
  if (method === 'turn/diff/updated') {
    return { agentSessionId, type: 'progress', payload: { ...commonPayload, stream: 'diff' } }
  }
  if (method === 'item/started') {
    if (isActivityItem(itemType)) {
      return {
        agentSessionId,
        type: 'activity_started',
        payload: {
          ...commonPayload,
          activityKind: activityKindForItem(itemType),
          tool: itemType,
          command: asString(item?.command),
          server: asString(item?.server),
          toolName: asString(item?.tool),
          status: asString(item?.status) ?? 'running',
        },
      }
    }
    return { agentSessionId, type: 'progress', payload: { ...commonPayload, stream: 'system' } }
  }
  if (method === 'item/completed') {
    if (isActivityItem(itemType)) {
      return {
        agentSessionId,
        type: 'activity_completed',
        payload: {
          ...commonPayload,
          activityKind: activityKindForItem(itemType),
          tool: itemType,
          command: asString(item?.command),
          server: asString(item?.server),
          toolName: asString(item?.tool),
          status: asString(item?.status) ?? 'completed',
          output: asString(item?.aggregatedOutput),
        },
      }
    }
    return { agentSessionId, type: 'progress', payload: { ...commonPayload, stream: 'system' } }
  }
  if (method.startsWith('item/')) {
    return {
      agentSessionId,
      type: 'progress',
      payload: { ...commonPayload, method, stream: 'system' },
    }
  }
  return {
    agentSessionId,
    type: 'progress',
    payload: { ...commonPayload, method, stream: 'system' },
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isActivityItem(itemType: string | undefined): boolean {
  return Boolean(
    itemType &&
    [
      'commandExecution',
      'fileChange',
      'mcpToolCall',
      'dynamicToolCall',
      'collabAgentToolCall',
    ].includes(itemType),
  )
}

function activityKindForItem(itemType: string | undefined): string {
  if (itemType === 'commandExecution') return 'command'
  if (itemType === 'fileChange') return 'fileChange'
  if (itemType === 'mcpToolCall') return 'mcpToolCall'
  if (itemType === 'collabAgentToolCall') return 'collabAgent'
  return 'tool'
}

function readString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') throw new Error(`Codex response missing ${key}`)
  const result = (value as Record<string, unknown>)[key]
  if (typeof result !== 'string') throw new Error(`Codex response missing ${key}`)
  return result
}
