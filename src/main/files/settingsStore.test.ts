import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
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
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('starts with the defaults when nothing is saved', async () => {
    expect(await new SettingsStore(file).get()).toEqual({ mpvPath: null })
  })

  it('remembers the chosen mpv across restarts, and forgets it on request', async () => {
    await new SettingsStore(file).setMpvPath('D:\\Tools\\mpv\\mpv.exe')
    expect(await new SettingsStore(file).get()).toEqual({ mpvPath: 'D:\\Tools\\mpv\\mpv.exe' })

    await new SettingsStore(file).setMpvPath(null)
    expect(await new SettingsStore(file).get()).toEqual({ mpvPath: null })
  })

  it('reads a corrupt or unexpected file as the defaults', async () => {
    const store = new SettingsStore(file)
    await store.setMpvPath('D:\\mpv.exe')

    await writeFile(file, '{ not json', 'utf8')
    expect(await new SettingsStore(file).get()).toEqual({ mpvPath: null })

    await writeFile(file, JSON.stringify({ version: 1, mpvPath: 42 }), 'utf8')
    expect(await new SettingsStore(file).get()).toEqual({ mpvPath: null })

    await writeFile(file, JSON.stringify({ version: 99, mpvPath: 'D:\\mpv.exe' }), 'utf8')
    expect(await new SettingsStore(file).get()).toEqual({ mpvPath: null })
  })

  it('leaves no temporary file behind', async () => {
    const store = new SettingsStore(file)
    await store.setMpvPath('D:\\one.exe')
    await store.setMpvPath('D:\\two.exe')
    expect(await readdir(join(folder, 'nested'))).toEqual(['settings.json'])
  })
})
