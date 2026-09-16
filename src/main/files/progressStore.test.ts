import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ShuffleSnapshot } from '../domain/shuffle'
import { ProgressStore } from './progressStore'

function snapshot(cycle: number, bag: string[] = ['b.mkv']): ShuffleSnapshot {
  return { cycle, bag, cycleDraws: ['a.mkv'], opened: ['a.mkv'] }
}

describe('ProgressStore', () => {
  let folder: string
  let file: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'fileshuffler-progress-'))
    file = join(folder, 'nested', 'progress.json')
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('remembers a folder’s progress and which folder was last used', async () => {
    const store = new ProgressStore(file)
    await store.save('/videos', snapshot(3))

    const reopened = new ProgressStore(file)
    expect(await reopened.read('/videos')).toEqual(snapshot(3))
    expect(await reopened.lastFolder()).toBe('/videos')
  })

  it('reports no progress for a folder it has never seen', async () => {
    const store = new ProgressStore(file)
    await store.save('/videos', snapshot(1))
    expect(await store.read('/other')).toBeNull()
  })

  it('leaves no temporary file behind', async () => {
    const store = new ProgressStore(file)
    await store.save('/videos', snapshot(1))
    await store.save('/videos', snapshot(2))
    expect(await readdir(join(folder, 'nested'))).toEqual(['progress.json'])
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1 })
  })

  it('starts fresh when the file is corrupt, rather than failing', async () => {
    const store = new ProgressStore(file)
    await store.save('/videos', snapshot(1))
    await writeFile(file, '{ this is not json', 'utf8')

    const reopened = new ProgressStore(file)
    expect(await reopened.read('/videos')).toBeNull()
    expect(await reopened.lastFolder()).toBeNull()
    // Still usable afterwards: the bad file is simply overwritten.
    await reopened.save('/videos', snapshot(4))
    expect(await new ProgressStore(file).read('/videos')).toEqual(snapshot(4))
  })

  it('ignores entries that are not a valid snapshot', async () => {
    await writeFile(
      file.replace(join('nested', 'progress.json'), 'flat.json'),
      JSON.stringify({
        version: 1,
        lastFolder: '/videos',
        folders: { '/videos': { snapshot: { cycle: 'soon', bag: [], cycleDraws: [], opened: [] } } }
      }),
      'utf8'
    )
    const store = new ProgressStore(join(folder, 'flat.json'))
    expect(await store.read('/videos')).toBeNull()
  })

  it('keeps only the most recent folders', async () => {
    const store = new ProgressStore(file, 2)
    await store.save('/one', snapshot(1))
    await store.save('/two', snapshot(1))
    await store.save('/three', snapshot(1))

    const reopened = new ProgressStore(file)
    expect(await reopened.read('/one')).toBeNull()
    expect(await reopened.read('/two')).not.toBeNull()
    expect(await reopened.read('/three')).not.toBeNull()
  })

  it('forgets every folder at once', async () => {
    const store = new ProgressStore(file)
    await store.save('/one', snapshot(1))
    await store.save('/two', snapshot(2))
    await store.clearAll()

    const reopened = new ProgressStore(file)
    expect(await reopened.read('/one')).toBeNull()
    expect(await reopened.read('/two')).toBeNull()
    expect(await reopened.lastFolder()).toBeNull()
  })

  it('forgets a folder on request', async () => {
    const store = new ProgressStore(file)
    await store.save('/videos', snapshot(1))
    await store.forget('/videos')

    const reopened = new ProgressStore(file)
    expect(await reopened.read('/videos')).toBeNull()
    expect(await reopened.lastFolder()).toBeNull()
  })
})
