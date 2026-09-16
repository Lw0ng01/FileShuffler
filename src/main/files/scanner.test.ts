import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { systemSkipRules, type SkipRules } from './scanRules'
import { scanRoots, type ScanFile } from './scanner'

/** No real system paths in a temp folder, so only the name-based rules matter here. */
const rules: SkipRules = { prefixes: [], caseInsensitive: true }

async function file(path: string, size = 4): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, 'x'.repeat(size))
}

async function collect(
  roots: string[],
  options: Partial<Parameters<typeof scanRoots>[0]> = {}
): Promise<{ files: ScanFile[]; summary: Awaited<ReturnType<typeof scanRoots>> }> {
  const files: ScanFile[] = []
  const summary = await scanRoots({
    roots,
    rules,
    onBatch: (batch) => {
      files.push(...batch)
    },
    ...options
  })
  return { files, summary }
}

describe('scanRoots', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fileshuffler-scan-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('finds allowlisted files at every depth, with their category and size', async () => {
    await file(join(root, 'holiday.mp4'), 10)
    await file(join(root, 'photos', 'cat.JPG'), 20)
    await file(join(root, 'photos', 'raw', 'shot.dng'), 30)
    await file(join(root, 'docs', 'taxes.pdf'), 40)
    await file(join(root, 'music', 'song.flac'), 50)
    await file(join(root, 'setup.exe'), 60)
    await file(join(root, 'notes'), 70)

    const { files, summary } = await collect([root])

    expect(files.map((entry) => entry.name).sort()).toEqual([
      'cat.JPG',
      'holiday.mp4',
      'shot.dng',
      'song.flac',
      'taxes.pdf'
    ])
    expect(files.find((entry) => entry.name === 'cat.JPG')).toMatchObject({
      category: 'photo',
      size: 20,
      root,
      folder: join(root, 'photos')
    })
    expect(summary).toMatchObject({ files: 5, bytes: 150, cancelled: false, errors: [] })
  })

  it('skips junk folders, dot-folders and dot-files', async () => {
    await file(join(root, 'node_modules', 'thing', 'clip.mp4'))
    await file(join(root, '.git', 'clip.mp4'))
    await file(join(root, '.hidden', 'clip.mp4'))
    await file(join(root, 'ok', '.secret.mp4'))
    await file(join(root, 'ok', 'keep.mp4'))

    const { files } = await collect([root])
    expect(files.map((entry) => entry.name)).toEqual(['keep.mp4'])
  })

  it('never follows links or junctions', async () => {
    await file(join(root, 'real', 'clip.mp4'))
    await mkdir(join(root, 'target'))
    await file(join(root, 'target', 'linked.mp4'))
    await symlink(join(root, 'target'), join(root, 'link-to-target'), 'junction')
    await symlink(join(root, 'real', 'clip.mp4'), join(root, 'link-to-clip.mp4'))

    const { files } = await collect([root])
    expect(files.map((entry) => entry.name).sort()).toEqual(['clip.mp4', 'linked.mp4'])
    expect(files.some((entry) => entry.path.includes('link-to'))).toBe(false)
  })

  it('records an unreadable folder and keeps going', async () => {
    await file(join(root, 'ok', 'keep.mp4'))
    const missing = join(root, 'not-there')

    const { files, summary } = await collect([root, missing])
    expect(files.map((entry) => entry.name)).toEqual(['keep.mp4'])
    expect(summary.errors).toHaveLength(1)
    expect(summary.errors[0]?.folder).toBe(missing)
  })

  it('refuses a relative root and a system location', async () => {
    const { summary } = await collect(['videos'], {
      roots: ['videos', 'C:\\Windows'],
      rules: systemSkipRules('win32', 'C:\\Users\\someone')
    })
    expect(summary.errors.map((error) => error.message)).toEqual([
      'Not an absolute path, so it was skipped',
      'A system location, so it was skipped'
    ])
    expect(summary.files).toBe(0)
  })

  it('delivers files in batches, one write at a time', async () => {
    for (let i = 0; i < 25; i++) await file(join(root, `clip-${i}.mp4`))
    const sizes: number[] = []
    let writing = false
    await scanRoots({
      roots: [root],
      rules,
      batchSize: 10,
      onBatch: async (batch) => {
        expect(writing).toBe(false)
        writing = true
        await new Promise((resolve) => setTimeout(resolve, 1))
        sizes.push(batch.length)
        writing = false
      }
    })
    expect(sizes.reduce((total, size) => total + size, 0)).toBe(25)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(10)
  })

  it('stops promptly when cancelled', async () => {
    for (let i = 0; i < 40; i++) await file(join(root, `folder-${i}`, 'clip.mp4'))
    const controller = new AbortController()
    const summary = await scanRoots({
      roots: [root],
      rules,
      batchSize: 1,
      signal: controller.signal,
      onBatch: () => controller.abort()
    })
    expect(summary.cancelled).toBe(true)
    expect(summary.files).toBeLessThan(40)
  })

  it('reports progress as it goes', async () => {
    await file(join(root, 'a', 'clip.mp4'))
    await file(join(root, 'b', 'clip.mp4'))
    const seen: number[] = []
    await collect([root], { onProgress: (progress) => seen.push(progress.folders) })
    expect(seen.length).toBeGreaterThan(0)
    expect(Math.max(...seen)).toBe(3)
  })
})
