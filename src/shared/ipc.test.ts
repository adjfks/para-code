import { describe, expect, it } from 'vitest'

import { IPC_CHANNELS } from './ipc'

describe('IPC channels', () => {
  it('keeps the app info channel stable', () => {
    expect(IPC_CHANNELS.appInfo).toBe('app:get-info')
  })

  it('keeps the run persistence channels stable', () => {
    expect(IPC_CHANNELS.runList).toBe('run:list')
    expect(IPC_CHANNELS.runGet).toBe('run:get')
  })
})
