import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsStore } from './settingsStore'

describe('SettingsStore', () => {
  let folder: string
  let file: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'fileshuffler-settings-'))
    file = join(folder, 'nested', 'settings.json')
    // `writeJsonAtomic` creates this folder on the first save, so tests that write the file
    // directly without saving first would otherwise fail on the missing directory rather than on
    // what they are actually checking.
    await mkdir(join(folder, 'nested'), { recursive: true })
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('starts with the defaults when nothing is saved', async () => {
    expect(await new SettingsStore(file).get()).toEqual({
      mpvPath: null,
      appearance: 'system',
      player: 'builtin'
    })
  })

  it('remembers the chosen mpv across restarts, and forgets it on request', async () => {
    await new SettingsStore(file).setMpvPath('D:\\Tools\\mpv\\mpv.exe')
    expect(await new SettingsStore(file).get()).toEqual({
      mpvPath: 'D:\\Tools\\mpv\\mpv.exe',
      appearance: 'system',
      player: 'builtin'
    })

    await new SettingsStore(file).setMpvPath(null)
    expect(await new SettingsStore(file).get()).toEqual({
      mpvPath: null,
      appearance: 'system',
      player: 'builtin'
    })
  })

  it('reads a corrupt or unexpected file as the defaults', async () => {
    const store = new SettingsStore(file)
    await store.setMpvPath('D:\\mpv.exe')

    const defaults = { mpvPath: null, appearance: 'system', player: 'builtin' }

    await writeFile(file, '{ not json', 'utf8')
    expect(await new SettingsStore(file).get()).toEqual(defaults)

    await writeFile(file, JSON.stringify({ version: 1, mpvPath: 42 }), 'utf8')
    expect(await new SettingsStore(file).get()).toEqual(defaults)

    await writeFile(file, JSON.stringify({ version: 99, mpvPath: 'D:\\mpv.exe' }), 'utf8')
    expect(await new SettingsStore(file).get()).toEqual(defaults)
  })

  it('remembers the chosen theme, and keeps the mpv choice alongside it', async () => {
    await new SettingsStore(file).setMpvPath('D:\\Tools\\mpv\\mpv.exe')
    await new SettingsStore(file).setAppearance('dark')

    expect(await new SettingsStore(file).get()).toEqual({
      mpvPath: 'D:\\Tools\\mpv\\mpv.exe',
      appearance: 'dark',
      player: 'builtin'
    })
  })

  it('reads a file saved before the theme setting existed, keeping the mpv choice', async () => {
    // Why `appearance` was added without bumping the file version: an unknown version reads as the
    // defaults, so bumping it would have silently thrown away everyone's chosen mpv to add a theme.
    await writeFile(file, JSON.stringify({ version: 1, mpvPath: 'D:\\mpv.exe' }), 'utf8')

    expect(await new SettingsStore(file).get()).toEqual({
      mpvPath: 'D:\\mpv.exe',
      appearance: 'system',
      player: 'builtin'
    })
  })

  it('uses the built-in player unless mpv was actually chosen', async () => {
    // Keeping upgrades on mpv was tried and was exactly wrong: the point of the built-in player is
    // not to see mpv's window, so a settings file written before it existed must not pin someone
    // to mpv. Only an explicit choice does that.
    await writeFile(file, JSON.stringify({ version: 1, mpvPath: null }), 'utf8')
    expect((await new SettingsStore(file).get()).player).toBe('builtin')

    await rm(file, { force: true })
    expect((await new SettingsStore(file).get()).player).toBe('builtin')

    await new SettingsStore(file).setPlayer('mpv')
    expect((await new SettingsStore(file).get()).player).toBe('mpv')
  })

  it('reads an unrecognised player as the built-in one', async () => {
    await writeFile(file, JSON.stringify({ version: 1, player: 'vlc' }), 'utf8')
    expect((await new SettingsStore(file).get()).player).toBe('builtin')
  })

  it('reads an unrecognised theme as following the system', async () => {
    await writeFile(file, JSON.stringify({ version: 1, appearance: 'sepia' }), 'utf8')
    expect((await new SettingsStore(file).get()).appearance).toBe('system')
  })

  it('leaves no temporary file behind', async () => {
    const store = new SettingsStore(file)
    await store.setMpvPath('D:\\one.exe')
    await store.setMpvPath('D:\\two.exe')
    expect(await readdir(join(folder, 'nested'))).toEqual(['settings.json'])
  })
})
