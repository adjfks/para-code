import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { safeStorage } from 'electron'

import { ProviderStore, validateBaseUrl } from './provider-store'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''),
  },
}))

const directories: string[] = []

describe('ProviderStore', () => {
  let store: ProviderStore
  let configPath: string
  let secretsPath: string

  beforeEach(async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'paracode-provider-'))
    directories.push(directory)
    configPath = path.join(directory, 'providers.json')
    secretsPath = path.join(directory, 'providers.secrets.json')
    store = new ProviderStore(configPath, secretsPath)
    await store.load()
  })

  afterEach(async () => {
    await Promise.all(
      directories.map((directory) => rm(directory, { recursive: true, force: true })),
    )
    directories.length = 0
  })

  it('creates the first provider as default and masks its API key', async () => {
    const providers = await store.create({
      name: 'OpenRouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test-4821',
      model: 'claude-sonnet-4.5',
    })

    expect(providers).toHaveLength(1)
    expect(providers[0].isDefault).toBe(true)
    expect(providers[0].apiKeyMasked).toBe('sk-***4821')
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual([
      expect.objectContaining({ hasApiKey: true, apiKeyLast4: '4821' }),
    ])
    const secrets = JSON.parse(await readFile(secretsPath, 'utf8')) as Array<{
      encryptedKey: number[]
    }>
    expect(secrets[0].encryptedKey).toEqual(expect.any(Array))
  })

  it('keeps the old API key when updating with an empty key', async () => {
    const [created] = await store.create({
      name: 'Provider',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-old-1234',
      model: 'model-a',
    })
    const providers = await store.update(created.id, {
      name: 'Provider',
      baseURL: 'https://api.example.com/v1',
      model: 'model-b',
    })

    expect(providers[0].apiKeyMasked).toBe('sk-***1234')
    expect(store.getApiKey(created.id)).toBe('sk-old-1234')
  })

  it('rejects duplicate names, invalid URLs, and non-local HTTP URLs', async () => {
    await store.create({
      name: 'Provider',
      baseURL: 'https://api.example.com/v1',
      model: 'model-a',
    })

    await expect(
      store.create({ name: 'Provider', baseURL: 'https://api.example.com/v1', model: 'model' }),
    ).rejects.toThrow('Provider 名称已存在。')
    await expect(
      store.create({ name: 'Other', baseURL: 'not-a-url', model: 'model' }),
    ).rejects.toThrow('Base URL 不是合法 URL。')
    await expect(
      store.create({ name: 'Other', baseURL: 'http://example.com/v1', model: 'model' }),
    ).rejects.toThrow('Base URL 必须使用 HTTPS')
  })

  it('allows local HTTP URLs and transfers the default after deletion', async () => {
    const [first] = await store.create({
      name: 'Local',
      baseURL: 'http://127.0.0.1:11434/v1',
      model: 'qwen3-coder',
    })
    await store.create({
      name: 'Remote',
      baseURL: 'https://api.example.com/v1',
      model: 'gpt-test',
    })
    const providers = await store.delete(first.id)

    expect(providers).toHaveLength(1)
    expect(providers[0].isDefault).toBe(true)
    expect(validateBaseUrl('http://localhost:11434/v1').protocol).toBe('http:')
  })

  it('loads encrypted secrets and providers from disk', async () => {
    await store.create({
      name: 'Provider',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-loaded-9988',
      model: 'model-a',
    })
    const reloaded = new ProviderStore(configPath, secretsPath)
    await reloaded.load()

    expect(reloaded.getApiKey(expect.any(String) as string)).toBeUndefined()
    const provider = reloaded.list()[0]
    expect(provider.apiKeyMasked).toBe('sk-***9988')
    expect(reloaded.getApiKey(provider.id)).toBe('sk-loaded-9988')
  })

  it('ignores invalid encrypted secrets', async () => {
    await writeFile(configPath, '[]', 'utf8')
    await writeFile(
      secretsPath,
      JSON.stringify([{ providerId: 'missing', encryptedKey: 'bad' }]),
      'utf8',
    )
    await store.load()

    expect(store.getApiKey('missing')).toBeUndefined()
  })
})

describe('safeStorage availability', () => {
  it('uses the mocked electron API', () => {
    expect(safeStorage.isEncryptionAvailable()).toBe(true)
  })
})
