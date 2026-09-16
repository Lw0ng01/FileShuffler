import { describe, expect, it, vi } from 'vitest'
import type { ClearableData } from '../../shared/settings'
import type { AppSettings } from '../files/settingsStore'
import type { MpvLocation } from '../playback/mpv/findMpv'
import type { MpvProbe } from '../playback/mpv/probeMpv'
import { SettingsService, type SettingsServiceDeps, type SettingsSource } from './settingsService'

class FakeStore implements SettingsSource {
  settings: AppSettings = { mpvPath: null }

  async get(): Promise<AppSettings> {
    return { ...this.settings }
  }

  async setMpvPath(path: string | null): Promise<AppSettings> {
    this.settings = { mpvPath: path }
    return { ...this.settings }
  }
}

const WORKING: MpvProbe = { ok: true, version: 'mpv v0.41.0' }

function setup(overrides: Partial<SettingsServiceDeps> = {}): {
  service: SettingsService
  store: FakeStore
  clear: Record<ClearableData, ReturnType<typeof vi.fn>>
  probe: ReturnType<typeof vi.fn>
} {
  const store = new FakeStore()
  const probe = vi.fn(async (): Promise<MpvProbe> => WORKING)
  const clear = {
    plays: vi.fn(),
    favorites: vi.fn(),
    progress: vi.fn(async () => {}),
    index: vi.fn()
  }
  const service = new SettingsService({
    store,
    locate: (chosen): MpvLocation =>
      chosen === null ? { path: 'mpv.exe', source: 'path' } : { path: chosen, source: 'settings' },
    probe,
    pickProgram: async () => null,
    clear,
    isScanning: () => false,
    now: () => 1_000,
    ...overrides
  })
  return { service, store, clear, probe }
}

describe('SettingsService mpv', () => {
  it('finds mpv automatically until one is chosen', () => {
    const { service } = setup()
    expect(service.getView().mpv).toEqual({
      path: 'mpv.exe',
      source: 'path',
      chosen: null,
      test: null,
      testing: false
    })
  })

  it('saves a chosen mpv only after checking it works', async () => {
    const { service, store, probe } = setup({ pickProgram: async () => 'D:\\Tools\\mpv.exe' })

    const view = await service.chooseMpv()
    expect(probe).toHaveBeenCalledWith('D:\\Tools\\mpv.exe')
    expect(store.settings.mpvPath).toBe('D:\\Tools\\mpv.exe')
    expect(view.mpv).toMatchObject({
      path: 'D:\\Tools\\mpv.exe',
      source: 'settings',
      test: { ok: true, message: 'mpv v0.41.0' }
    })
    expect(view.lastNotice).toBe('Shuffles will use mpv v0.41.0.')
  })

  it('refuses a program that is not a working mpv, and saves nothing', async () => {
    const { service, store } = setup({
      pickProgram: async () => 'D:\\Games\\game.exe',
      probe: async () => ({ ok: false, reason: "That program ran, but it isn't mpv." })
    })

    const view = await service.chooseMpv()
    expect(store.settings.mpvPath).toBeNull()
    expect(view.mpv.source).toBe('path')
    expect(view.lastError).toBe("That can't be used as mpv: That program ran, but it isn't mpv.")
  })

  it('changes nothing when the picker is cancelled', async () => {
    const { service, store, probe } = setup()
    await service.chooseMpv()
    expect(probe).not.toHaveBeenCalled()
    expect(store.settings.mpvPath).toBeNull()
  })

  it('goes back to finding mpv automatically', async () => {
    const { service, store } = setup({ pickProgram: async () => 'D:\\Tools\\mpv.exe' })
    await service.chooseMpv()

    const view = await service.useDefaultMpv()
    expect(store.settings.mpvPath).toBeNull()
    expect(view.mpv).toMatchObject({ source: 'path', chosen: null, test: null })
  })

  it('reads a saved choice at startup', async () => {
    const { service, store } = setup()
    store.settings = { mpvPath: 'E:\\mpv\\mpv.exe' }
    await service.load()
    expect(service.getView().mpv).toMatchObject({ path: 'E:\\mpv\\mpv.exe', source: 'settings' })
  })

  it('tests the mpv a shuffle would start, and reports why it failed', async () => {
    // Asserted on directly: it replaces the default fake that setup() would otherwise return.
    const probe = vi.fn(async (): Promise<MpvProbe> => ({
      ok: false,
      reason: 'No program was found at that location.'
    }))
    const { service } = setup({ probe })

    const view = await service.testMpv()
    expect(probe).toHaveBeenCalledWith('mpv.exe')
    expect(view.mpv.test).toEqual({
      ok: false,
      message: 'No program was found at that location.',
      testedAt: 1_000
    })
    expect(view.mpv.testing).toBe(false)
  })
})

describe('SettingsService clearing data', () => {
  it('clears exactly the data asked for', async () => {
    const { service, clear } = setup()

    const view = await service.clearData('plays')
    expect(clear.plays).toHaveBeenCalledTimes(1)
    expect(clear.favorites).not.toHaveBeenCalled()
    expect(clear.progress).not.toHaveBeenCalled()
    expect(clear.index).not.toHaveBeenCalled()
    expect(view.lastNotice).toBe('Play history cleared.')
  })

  it('refuses to clear the index while a scan is writing to it', async () => {
    const { service, clear } = setup({ isScanning: () => true })

    const view = await service.clearData('index')
    expect(clear.index).not.toHaveBeenCalled()
    expect(view.lastError).toBe('Stop the scan before clearing the index.')
  })

  it('explains a failure instead of claiming it worked', async () => {
    const { service } = setup({
      clear: {
        plays: vi.fn(),
        favorites: vi.fn(),
        progress: vi.fn(async () => {
          throw new Error('disk is read-only')
        }),
        index: vi.fn()
      }
    })

    const view = await service.clearData('progress')
    expect(view.lastNotice).toBeNull()
    expect(view.lastError).toBe('Could not clear that: disk is read-only')
  })
})
