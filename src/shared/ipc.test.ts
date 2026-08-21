import { describe, expect, it } from 'vitest'

import { IPC_CHANNELS } from './ipc'

describe('IPC channels', () => {
  it('keeps the app info channel stable', () => {
    expect(IPC_CHANNELS.appInfo).toBe('app:get-info')
  })
})
