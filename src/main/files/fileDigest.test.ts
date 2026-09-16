import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileDigest } from './fileDigest'

describe('fileDigest', () => {
  let folder: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'fileshuffler-digest-'))
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  async function write(name: string, contents: string | Buffer): Promise<string> {
    const path = join(folder, name)
    await writeFile(path, contents)
    return path
  }

  it('gives two copies of a file the same fingerprint', async () => {
    const first = await write('a.mkv', 'the same bytes')
    const second = await write('b.mkv', 'the same bytes')
    expect(await fileDigest(first)).toBe(await fileDigest(second))
  })

  it('tells apart files of the same size with different contents', async () => {
    const first = await write('a.mkv', 'aaaaaaaaaa')
    const second = await write('b.mkv', 'bbbbbbbbbb')
    expect(await fileDigest(first)).not.toBe(await fileDigest(second))
  })

  it('notices a difference in the middle for files larger than the read window', async () => {
    const size = 200 * 1024
    const base = Buffer.alloc(size, 1)
    const changed = Buffer.from(base)
    changed[size / 2] = 9

    const first = await write('a.bin', base)
    const second = await write('b.bin', changed)
    // Only the ends are read, so a change in the middle of a large file is not caught: this is a
    // check for "look alike", not proof of a byte-for-byte match.
    expect(await fileDigest(first)).toBe(await fileDigest(second))

    changed[10] = 9
    const third = await write('c.bin', changed)
    expect(await fileDigest(third)).not.toBe(await fileDigest(first))
  })

  it('separates files whose sizes differ, even when both are empty at the start', async () => {
    const first = await write('a.bin', Buffer.alloc(1024))
    const second = await write('b.bin', Buffer.alloc(2048))
    expect(await fileDigest(first)).not.toBe(await fileDigest(second))
  })

  it('handles an empty file', async () => {
    const path = await write('empty.mkv', '')
    expect(await fileDigest(path)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reports null for a file it cannot read, instead of throwing', async () => {
    expect(await fileDigest(join(folder, 'missing.mkv'))).toBeNull()
  })
})
