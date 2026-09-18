import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyLegacyData, dataFolder, dataFolderName } from './dataFolder'

describe('dataFolderName', () => {
  it('keeps the installed app and development runs apart', () => {
    expect(dataFolderName(true)).toBe('FileShuffler')
    expect(dataFolderName(false)).toBe('FileShuffler Dev')
  })
})

describe('dataFolder', () => {
  it('puts the data under the system location by default', () => {
    expect(dataFolder(join('C:', 'AppData'), false, {})).toBe(
      join('C:', 'AppData', 'FileShuffler Dev')
    )
    expect(dataFolder(join('C:', 'AppData'), true, {})).toBe(join('C:', 'AppData', 'FileShuffler'))
  })

  it('follows FILESHUFFLER_DATA, so a test can run against a copy rather than the real library', () => {
    const env = { FILESHUFFLER_DATA: join('D:', 'copy') }
    expect(dataFolder(join('C:', 'AppData'), false, env)).toBe(join('D:', 'copy'))
    // The override is absolute, so it applies to the installed app too.
    expect(dataFolder(join('C:', 'AppData'), true, env)).toBe(join('D:', 'copy'))
  })

  it('ignores an override that is empty or only spaces', () => {
    expect(dataFolder(join('C:', 'AppData'), false, { FILESHUFFLER_DATA: '' })).toBe(
      join('C:', 'AppData', 'FileShuffler Dev')
    )
    expect(dataFolder(join('C:', 'AppData'), false, { FILESHUFFLER_DATA: '   ' })).toBe(
      join('C:', 'AppData', 'FileShuffler Dev')
    )
  })
})

describe('copyLegacyData', () => {
  let root: string
  let legacy: string
  let target: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fileshuffler-data-'))
    legacy = join(root, 'file-shuffler')
    target = join(root, 'FileShuffler Dev')
    await mkdir(legacy)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("copies the app's own files into a new folder and leaves the old one as a backup", async () => {
    await writeFile(join(legacy, 'index.db'), 'db')
    await writeFile(join(legacy, 'index.db-wal'), 'wal')
    await writeFile(join(legacy, 'progress.json'), '{}')
    // Electron's own cache: not ours, so not copied.
    await mkdir(join(legacy, 'Cache'))

    expect(copyLegacyData(legacy, target)).toEqual(['index.db', 'index.db-wal', 'progress.json'])
    expect(readFileSync(join(target, 'index.db'), 'utf8')).toBe('db')
    expect(existsSync(join(target, 'Cache'))).toBe(false)
    expect(existsSync(join(legacy, 'index.db'))).toBe(true)
  })

  it('never overwrites a folder that already has an index', async () => {
    await writeFile(join(legacy, 'index.db'), 'old')
    await mkdir(target)
    await writeFile(join(target, 'index.db'), 'current')

    expect(copyLegacyData(legacy, target)).toEqual([])
    expect(readFileSync(join(target, 'index.db'), 'utf8')).toBe('current')
  })

  it('does nothing when the old folder holds nothing of ours', async () => {
    expect(copyLegacyData(legacy, target)).toEqual([])
    expect(copyLegacyData(join(root, 'missing'), target)).toEqual([])
    expect(existsSync(target)).toBe(false)
  })

  it('happens only once: a second start finds the copied index and stops', async () => {
    await writeFile(join(legacy, 'index.db'), 'db')
    expect(copyLegacyData(legacy, target)).toEqual(['index.db'])

    await writeFile(join(legacy, 'index.db'), 'changed later')
    expect(copyLegacyData(legacy, target)).toEqual([])
    expect(readFileSync(join(target, 'index.db'), 'utf8')).toBe('db')
  })
})
