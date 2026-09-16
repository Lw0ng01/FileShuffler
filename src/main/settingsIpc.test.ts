import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { SETTINGS_CHANNELS } from '../shared/settings'
import type { IpcRegistry } from './ipc'
import { registerSettingsIpc, type SettingsBackend } from './settingsIpc'

/** Stands in for Electron's ipcMain, keeping the handlers so a test can call them. */
class FakeIpc implements IpcRegistry {
  readonly handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void {
    this.handlers.set(channel, listener)
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel)
  }

  invoke(channel: string, ...args: unknown[]): unknown {
    const handler = this.handlers.get(channel)
    if (handler === undefined) throw new Error(`no handler for ${channel}`)
    return handler({} as IpcMainInvokeEvent, ...args)
  }
}

function setup(trusted = true): {
  ipc: FakeIpc
  backend: SettingsBackend
  unregister: () => void
} {
  const ipc = new FakeIpc()
  const backend = {
    getView: vi.fn(),
    chooseMpv: vi.fn(),
    useDefaultMpv: vi.fn(),
    testMpv: vi.fn(),
    clearData: vi.fn()
  } as unknown as SettingsBackend
  const unregister = registerSettingsIpc(ipc, backend, () => trusted)
  return { ipc, backend, unregister }
}

describe('registerSettingsIpc', () => {
  it('forwards each command', () => {
    const { ipc, backend } = setup()
    ipc.invoke(SETTINGS_CHANNELS.getView)
    ipc.invoke(SETTINGS_CHANNELS.chooseMpv)
    ipc.invoke(SETTINGS_CHANNELS.useDefaultMpv)
    ipc.invoke(SETTINGS_CHANNELS.testMpv)
    for (const what of ['plays', 'favorites', 'progress', 'index']) {
      ipc.invoke(SETTINGS_CHANNELS.clearData, what)
    }

    expect(backend.getView).toHaveBeenCalledTimes(1)
    expect(backend.chooseMpv).toHaveBeenCalledTimes(1)
    expect(backend.useDefaultMpv).toHaveBeenCalledTimes(1)
    expect(backend.testMpv).toHaveBeenCalledTimes(1)
    expect(backend.clearData).toHaveBeenCalledTimes(4)
  })

  it('never passes a path along when choosing mpv', () => {
    const { ipc, backend } = setup()
    ipc.invoke(SETTINGS_CHANNELS.chooseMpv, 'C:\\Windows\\System32\\cmd.exe')
    expect(backend.chooseMpv).toHaveBeenCalledWith()
  })

  it('rejects anything that is not a known kind of data to clear', () => {
    const { ipc, backend } = setup()
    for (const bad of [undefined, 42, '', 'everything', 'settings', ['plays']]) {
      expect(() => ipc.invoke(SETTINGS_CHANNELS.clearData, bad)).toThrow(
        'Expected data that Settings knows how to clear'
      )
    }
    expect(backend.clearData).not.toHaveBeenCalled()
  })

  it('rejects every request from an untrusted sender', () => {
    const { ipc, backend } = setup(false)
    expect(() => ipc.invoke(SETTINGS_CHANNELS.clearData, 'index')).toThrow('untrusted sender')
    expect(backend.clearData).not.toHaveBeenCalled()
  })

  it('removes all of its handlers', () => {
    const { ipc, unregister } = setup()
    const commands = Object.values(SETTINGS_CHANNELS).filter(
      (channel) => channel !== SETTINGS_CHANNELS.view
    )
    expect(ipc.handlers.size).toBe(commands.length)
    unregister()
    expect(ipc.handlers.size).toBe(0)
  })
})
