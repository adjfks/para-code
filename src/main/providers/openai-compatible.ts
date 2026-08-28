import type { ProviderTestResult } from '../../shared/ipc'
import { validateBaseUrl } from './provider-store'

const REQUEST_TIMEOUT_MS = 10_000

export async function listOpenAICompatibleModels(options: {
  baseURL: string
  apiKey?: string
}): Promise<ProviderTestResult> {
  const baseUrl = validateBaseUrl(options.baseURL)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const modelsUrl = new URL(baseUrl)
    modelsUrl.pathname = `${modelsUrl.pathname.replace(/\/$/, '')}/models`
    const response = await fetch(modelsUrl, {
      headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined,
      signal: controller.signal,
    })
    if (!response.ok) {
      return {
        ok: false,
        message: `Provider 返回 ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      }
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      return { ok: false, message: 'Provider 返回的不是 JSON 响应。' }
    }
    const payload = (await response.json()) as { data?: unknown }
    if (!Array.isArray(payload.data)) {
      return { ok: false, message: 'Provider 模型列表格式不正确。' }
    }
    const models = payload.data
      .map((item) => (item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined))
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    return {
      ok: true,
      message: models.length ? '连接成功。' : '连接成功，但 Provider 未返回模型。',
      models,
    }
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '连接 Provider 超时。'
        : '无法连接 Provider。'
    return { ok: false, message }
  } finally {
    clearTimeout(timeout)
  }
}
