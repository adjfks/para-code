import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

import type { AgentEvent } from '../../shared/ipc'
import type { AgentProvider, AgentRunContext } from './types'

interface JsonRpcResponse {
  id?: number
  result?: Record<string, unknown>
  error?: { message?: string }
}

interface JsonRpcNotification {
  method?: string
  params?: Record<string, unknown>
}

export class CodexAppServerProvider implements AgentProvider {
  private readonly command: string

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

    client.onNotification((notification) => {
      const event = mapCodexNotification(notification, agentSessionId)
      if (event) emit(event)
    })
    processHandle.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString().trim()
      if (message) {
        emit({
          agentSessionId,
          type: 'progress',
          payload: { stream: 'stderr', message },
        })
      }
    })

    await client.request('initialize', {
      clientInfo: { name: 'paracode', version: '0.1.0' },
      capabilities: {},
    })
    client.notify('initialized', {})
    const thread = await client.request('thread/start', {
      cwd: context.worktreePath,
      approvalPolicy: 'on-request',
      sandbox: 'workspaceWrite',
      personality: 'pragmatic',
      serviceName: 'paracode',
    })
    const threadId = readString(thread.result?.thread, 'id')

    emit({
      agentSessionId,
      type: 'session_started',
      payload: { provider: 'codex-app-server', threadId },
    })

    await client.request('turn/start', {
      threadId,
      cwd: context.worktreePath,
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

    return { agentSessionId }
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

  onNotification(listener: (notification: JsonRpcNotification) => void): void {
    this.notificationListener = listener
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
): Omit<AgentEvent, 'id' | 'runId' | 'sequence' | 'timestamp'> | undefined {
  const method = notification.method
  if (!method) return undefined
  const payload = notification.params ?? {}

  if (method === 'turn/started') {
    return { agentSessionId, type: 'phase_changed', payload: { phase: 'planning', ...payload } }
  }
  if (method === 'turn/completed') {
    return { agentSessionId, type: 'session_completed', payload }
  }
  if (method.includes('requestApproval')) {
    return { agentSessionId, type: 'approval_request', payload: { method, ...payload } }
  }
  if (method === 'item/agentMessage/delta') {
    return { agentSessionId, type: 'progress', payload: { ...payload, stream: 'agent' } }
  }
  if (method.startsWith('item/')) {
    return { agentSessionId, type: 'tool_finished', payload: { method, ...payload } }
  }
  return { agentSessionId, type: 'progress', payload: { method, ...payload } }
}

function readString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') throw new Error(`Codex response missing ${key}`)
  const result = (value as Record<string, unknown>)[key]
  if (typeof result !== 'string') throw new Error(`Codex response missing ${key}`)
  return result
}
