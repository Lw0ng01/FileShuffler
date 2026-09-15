import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileIdentity, sameFile, type FileIdentity } from './fileIdentity'

describe('file identity', () => {
  let folder: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'fileshuffler-test-'))
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  async function read(path: string): Promise<FileIdentity> {
    const identity = await readFileIdentity(path)
    expect(identity).not.toBeNull()
    return identity as FileIdentity
  }

  it('recognizes an unchanged file', async () => {
    const path = join(folder, 'clip.mkv')
    await writeFile(path, 'original')
    expect(sameFile(await read(path), await read(path))).toBe(true)
  })

  it('notices when the file’s contents change', async () => {
    const path = join(folder, 'clip.mkv')
    await writeFile(path, 'original')
    const before = await read(path)
    await appendFile(path, ' and more')
    expect(sameFile(before, await read(path))).toBe(false)
  })

  it('notices when a different file takes its place', async () => {
    const path = join(folder, 'clip.mkv')
    await writeFile(path, 'original')
    const before = await read(path)
    await writeFile(join(folder, 'replacement'), 'original')
    await rename(join(folder, 'replacement'), path)
    expect(sameFile(before, await read(path))).toBe(false)
  })

  it('never treats a folder as the same file', async () => {
    const path = join(folder, 'clip.mkv')
    await mkdir(path)
    const identity = await read(path)
    expect(identity.isFile).toBe(false)
    expect(sameFile(identity, identity)).toBe(false)
  })

  it('reports a missing file as null', async () => {
    expect(await readFileIdentity(join(folder, 'missing.mkv'))).toBeNull()
  })

  it('rejects when it cannot tell, instead of reporting the file as missing', async () => {
    const file = join(folder, 'clip.mkv')
    await writeFile(file, 'x')
    // macOS says ENOTDIR for a path through a file; Windows says ENOENT.
    await expect(readFileIdentity(join(file, 'child'))).rejects.toMatchObject({
      code: expect.stringMatching(/^(ENOTDIR|ENOENT)$/)
    })
  })

  it('rejects when the folder itself is gone, as when a drive is unplugged', async () => {
    await expect(readFileIdentity(join(folder, 'gone', 'clip.mkv'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
