import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDriveSpace } from './driveSpace'

describe('readDriveSpace', () => {
  let folder: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'fileshuffler-space-'))
  })

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('reports a real drive’s size and free space', async () => {
    const space = await readDriveSpace(folder)
    expect(space).not.toBeNull()
    expect(space?.total).toBeGreaterThan(0)
    expect(space?.free).toBeGreaterThanOrEqual(0)
    expect(space?.free).toBeLessThanOrEqual(space?.total as number)
  })

  it('reports null for a path that isn’t there, instead of throwing', async () => {
    expect(await readDriveSpace(join(folder, 'no-such-folder'))).toBeNull()
  })
})
