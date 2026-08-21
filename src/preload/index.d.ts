import type { ParaCodeApi } from '../shared/ipc'

declare global {
  interface Window {
    paracode: ParaCodeApi
  }
}

export {}
