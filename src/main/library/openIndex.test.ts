import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IndexDb } from './indexDb'
import { isDamagedDatabase, openIndex } from './openIndex'

describe('openIndex', () => {
  let folder: string
  let file: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'fileshuffler-open-index-'))
    file = join(folder, 'index.db')
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('opens an existing index as it is', () => {
    const first = new IndexDb(file)
    first.addRoot('D:\\Media')
    first.close()

    const { db, setAside } = openIndex(file)
    try {
      expect(setAside).toBeNull()
      expect(db.roots().map((root) => root.path)).toEqual(['D:\\Media'])
    } finally {
      db.close()
    }
  })

  it('sets a damaged index aside and starts a fresh one', () => {
    const damaged = Buffer.from('not a database '.repeat(400))
    writeFileSync(file, damaged)
    writeFileSync(`${file}-wal`, 'old journal')

    const { db, setAside } = openIndex(file, undefined, () => 1234)
    try {
      expect(setAside).toBe(`${file}.unreadable-1234`)
      // The damaged file is kept, byte for byte.
      expect(readFileSync(setAside as string)).toEqual(damaged)
      // SQLite may discard the old journal itself on the failed open; either way, none of it is
      // left where the fresh index would replay it.
      const leftover = existsSync(`${file}-wal`) ? readFileSync(`${file}-wal`, 'utf8') : ''
      expect(leftover).not.toContain('old journal')
      // The fresh index works.
      db.addRoot('D:\\Media')
      expect(db.roots()).toHaveLength(1)
    } finally {
      db.close()
    }
  })

  it('leaves the index alone when opening fails for another reason', () => {
    writeFileSync(file, 'kept')
    const busy = Object.assign(new Error('database is locked'), { errcode: 5 })
    const open = (): IndexDb => {
      throw busy
    }

    expect(() => openIndex(file, open)).toThrow(busy)
    expect(readFileSync(file, 'utf8')).toBe('kept')
    expect(existsSync(`${file}.unreadable-1234`)).toBe(false)
  })

  it('recognizes damage from SQLite result codes only', () => {
    expect(isDamagedDatabase({ errcode: 26 })).toBe(true)
    expect(isDamagedDatabase({ errcode: 11 })).toBe(true)
    // SQLITE_CORRUPT_INDEX is an extended code on top of SQLITE_CORRUPT.
    expect(isDamagedDatabase({ errcode: 779 })).toBe(true)
    expect(isDamagedDatabase({ errcode: 5 })).toBe(false)
    expect(isDamagedDatabase(new Error('file is not a database'))).toBe(false)
    expect(isDamagedDatabase(null)).toBe(false)
  })
})
