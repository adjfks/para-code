import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { safeStorage } from 'electron'

import type {
  ProviderConfigInput,
  ProviderConnectionStatus,
  ProviderSummary,
} from '../../shared/ipc'

interface StoredProvider {
  id: string
  name: string
  sdkType: 'openai-compatible'
  baseURL: string
  model: string
  models: string[]
  isDefault: boolean
  connectionStatus: ProviderConnectionStatus
  lastValidatedAt?: string
  hasApiKey: boolean
  apiKeyLast4?: string
  createdAt: string
  updatedAt: string
}

interface StoredSecret {
  providerId: string
  encryptedKey: number[]
}

export class ProviderStore {
  private providers: StoredProvider[] = []
  private secrets = new Map<string, string>()

  constructor(
    private readonly configPath: string,
    private readonly secretsPath: string,
  ) {}

  async load(): Promise<void> {
    this.providers = await readJson<StoredProvider[]>(this.configPath, [])
    const storedSecrets = await readJson<StoredSecret[]>(this.secretsPath, [])
    this.secrets = new Map()
    for (const secret of storedSecrets) {
      if (!secret.providerId || !Array.isArray(secret.encryptedKey)) continue
      try {
        this.secrets.set(
          secret.providerId,
          safeStorage.decryptString(Buffer.from(secret.encryptedKey)),
        )
      } catch {
        continue
      }
    }
    this.normalizeDefaults()
  }

  list(): ProviderSummary[] {
    return this.providers.map((provider) => this.toSummary(provider))
  }

  get(id: string): ProviderSummary | undefined {
    const provider = this.providers.find((item) => item.id === id)
    return provider ? this.toSummary(provider) : undefined
  }

  getApiKey(id: string): string | undefined {
    return this.secrets.get(id)
  }

  async create(input: ProviderConfigInput): Promise<ProviderSummary[]> {
    const validated = validateInput(input)
    this.assertUniqueName(validated.name)
    const now = new Date().toISOString()
    const provider: StoredProvider = {
      id: randomUUID(),
      name: validated.name,
      sdkType: 'openai-compatible',
      baseURL: validated.baseURL,
      model: validated.model,
      models: uniqueModels([validated.model]),
      isDefault: this.providers.length === 0,
      connectionStatus: 'unknown',
      hasApiKey: Boolean(input.apiKey),
      apiKeyLast4: input.apiKey ? keyLast4(input.apiKey) : undefined,
      createdAt: now,
      updatedAt: now,
    }
    this.providers.push(provider)
    if (input.apiKey) this.secrets.set(provider.id, input.apiKey)
    await this.save()
    return this.list()
  }

  async update(id: string, input: ProviderConfigInput): Promise<ProviderSummary[]> {
    const provider = this.requireStored(id)
    const validated = validateInput(input)
    if (this.providers.some((item) => item.id !== id && item.name === validated.name)) {
      throw new Error('Provider 名称已存在。')
    }
    provider.name = validated.name
    provider.baseURL = validated.baseURL
    provider.model = validated.model
    if (!provider.models.includes(validated.model)) {
      provider.models = uniqueModels([validated.model, ...provider.models])
    }
    provider.connectionStatus = 'unknown'
    provider.lastValidatedAt = undefined
    provider.updatedAt = new Date().toISOString()
    if (input.apiKey) {
      this.secrets.set(id, input.apiKey)
      provider.hasApiKey = true
      provider.apiKeyLast4 = keyLast4(input.apiKey)
    }
    await this.save()
    return this.list()
  }

  async delete(id: string): Promise<ProviderSummary[]> {
    const provider = this.requireStored(id)
    this.providers = this.providers.filter((item) => item.id !== id)
    this.secrets.delete(id)
    if (provider.isDefault) {
      if (this.providers[0]) this.providers[0].isDefault = true
    } else {
      this.normalizeDefaults()
    }
    await this.save()
    return this.list()
  }

  async setDefault(id: string): Promise<ProviderSummary[]> {
    this.requireStored(id)
    this.providers.forEach((provider) => {
      provider.isDefault = provider.id === id
    })
    await this.save()
    return this.list()
  }

  async updateModels(id: string, models: string[]): Promise<void> {
    const provider = this.requireStored(id)
    provider.models = uniqueModels([...models, provider.model])
    provider.updatedAt = new Date().toISOString()
    await this.save()
  }

  async updateConnection(
    id: string,
    status: ProviderConnectionStatus,
    models?: string[],
  ): Promise<void> {
    const provider = this.requireStored(id)
    provider.connectionStatus = status
    provider.lastValidatedAt = new Date().toISOString()
    if (models?.length) provider.models = uniqueModels([...models, provider.model])
    provider.updatedAt = new Date().toISOString()
    await this.save()
  }

  private requireStored(id: string): StoredProvider {
    const provider = this.providers.find((item) => item.id === id)
    if (!provider) throw new Error('Provider 不存在。')
    return provider
  }

  private assertUniqueName(name: string): void {
    if (this.providers.some((provider) => provider.name === name)) {
      throw new Error('Provider 名称已存在。')
    }
  }

  private normalizeDefaults(): void {
    if (!this.providers.some((provider) => provider.isDefault) && this.providers[0]) {
      this.providers[0].isDefault = true
    }
  }

  private toSummary(provider: StoredProvider): ProviderSummary {
    return {
      id: provider.id,
      name: provider.name,
      sdkType: provider.sdkType,
      baseURL: provider.baseURL,
      model: provider.model,
      apiKeyMasked: provider.hasApiKey ? `sk-***${provider.apiKeyLast4 ?? ''}` : '未设置 API Key',
      models: [...provider.models],
      isDefault: provider.isDefault,
      connectionStatus: provider.connectionStatus,
      lastValidatedAt: provider.lastValidatedAt,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    }
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true })
    await Promise.all([writeJsonAtomic(this.configPath, this.providers), this.saveSecrets()])
  }

  private async saveSecrets(): Promise<void> {
    const storedSecrets: StoredSecret[] = [...this.secrets.entries()].map(
      ([providerId, apiKey]) => ({
        providerId,
        encryptedKey: [...safeStorage.encryptString(apiKey)],
      }),
    )
    await writeJsonAtomic(this.secretsPath, storedSecrets)
  }
}

export function validateBaseUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Base URL 不是合法 URL。')
  }
  if (url.protocol !== 'https:' && !isLocalHttpUrl(url)) {
    throw new Error('Base URL 必须使用 HTTPS；本地服务可使用 localhost 或 127.0.0.1。')
  }
  return url
}

function validateInput(input: ProviderConfigInput): {
  name: string
  baseURL: string
  model: string
} {
  const name = input.name.trim()
  const model = input.model.trim()
  if (!name) throw new Error('Provider 名称不能为空。')
  if (!model) throw new Error('默认模型不能为空。')
  const baseURL = input.baseURL.trim()
  validateBaseUrl(baseURL)
  return { name, baseURL: baseURL.replace(/\/$/, ''), model }
}

function isLocalHttpUrl(url: URL): boolean {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
}

function keyLast4(value: string): string {
  return value.slice(-4)
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))]
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(filePath, 'utf8')
    return JSON.parse(content) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw new Error(`读取 Provider 配置失败：${path.basename(filePath)}`)
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, filePath)
  } catch {
    await rm(temporaryPath, { force: true })
    throw new Error(`保存 Provider 配置失败：${path.basename(filePath)}`)
  }
}
