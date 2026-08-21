export const IPC_CHANNELS = {
  appInfo: 'app:get-info',
} as const

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
  arch: string
}

export interface ParaCodeApi {
  getAppInfo: () => Promise<AppInfo>
}
