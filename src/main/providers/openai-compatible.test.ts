import { afterEach, describe, expect, it, vi } from 'vitest'

import { listOpenAICompatibleModels } from './openai-compatible'

const fetchMock = vi.fn()

vi.stubGlobal('fetch', fetchMock)

describe('listOpenAICompatibleModels', () => {
  afterEach(() => {
    fetchMock.mockReset()
  })

  it('returns parsed model IDs', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] }), {
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await listOpenAICompatibleModels({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'secret',
    })

    expect(result).toEqual({ ok: true, message: '连接成功。', models: ['model-a', 'model-b'] })
    expect(fetchMock.mock.calls[0][0].href).toBe('https://api.example.com/v1/models')
  })

  it('reports HTTP errors without leaking credentials', async () => {
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }))

    const result = await listOpenAICompatibleModels({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'secret',
    })

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Provider 返回 401')
    expect(result.message).not.toContain('secret')
  })

  it('reports non-JSON responses', async () => {
    fetchMock.mockResolvedValue(new Response('<html></html>', { status: 200 }))

    const result = await listOpenAICompatibleModels({ baseURL: 'https://api.example.com/v1' })

    expect(result).toEqual({ ok: false, message: 'Provider 返回的不是 JSON 响应。' })
  })
})
