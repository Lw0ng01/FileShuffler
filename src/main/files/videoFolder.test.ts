import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listVideoFiles, VIDEO_EXTENSIONS } from './videoFolder'

describe('listVideoFiles', () => {
  let folder: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'fileshuffler-test-'))
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('lists only allowlisted video files at the top level of the folder', async () => {
    const names = ['b.mkv', 'A.MP4', 'clip.webm', 'notes.txt', '.hidden.mp4', 'movie.mkv.part']
    for (const name of names) await writeFile(join(folder, name), 'x')
    await mkdir(join(folder, 'season 2'))
    await writeFile(join(folder, 'season 2', 'inside-subfolder.mp4'), 'x')
    await mkdir(join(folder, 'looks-like-a-video.mp4'))
    await symlink(join(folder, 'b.mkv'), join(folder, 'link-to-b.mkv'))

    expect(await listVideoFiles(folder)).toEqual(['A.MP4', 'b.mkv', 'clip.webm'])
  })

  it('does not treat TypeScript source extensions as videos', async () => {
    expect(VIDEO_EXTENSIONS.has('.ts')).toBe(false)
    expect(VIDEO_EXTENSIONS.has('.mts')).toBe(false)
    await writeFile(join(folder, 'player.ts'), 'x')
    expect(await listVideoFiles(folder)).toEqual([])
  })

  it('rejects a relative folder path', async () => {
    await expect(listVideoFiles('videos')).rejects.toThrow('Expected an absolute folder path')
  })

  it('fails for a folder that does not exist', async () => {
    await expect(listVideoFiles(join(folder, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
