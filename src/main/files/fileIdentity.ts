import { lstat, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Enough to tell whether the file at a path is still the same file (PROJECT.md §2.3), so a delete
 * never trashes a different file that took its place. BigInt values keep Windows file IDs and
 * nanosecond timestamps exact. Some drives (for example FAT-formatted USB sticks) report no stable
 * file ID; size and modification time still catch most replacements there.
 */
export interface FileIdentity {
  isFile: boolean
  dev: bigint
  ino: bigint
  size: bigint
  mtimeNs: bigint
}

/**
 * The identity of whatever is at `path`, without following links. Resolves null only when the file
 * is missing from a folder that still exists; rejects on anything else (a disconnected drive, a
 * missing folder, missing permission), so callers treat those as "can't tell".
 */
export async function readFileIdentity(path: string): Promise<FileIdentity | null> {
  try {
    const stats = await lstat(path, { bigint: true })
    return {
      isFile: stats.isFile(),
      dev: stats.dev,
      ino: stats.ino,
      size: stats.size,
      mtimeNs: stats.mtimeNs
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // Windows also reports ENOENT when the folder or the whole drive is gone (an unplugged USB
    // drive), so only a folder that is still there proves the file itself was removed.
    if (await isFolder(dirname(path))) return null
    throw error
  }
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** True only for two readings of the same, unchanged regular file. */
export function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return (
    a.isFile &&
    b.isFile &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs
  )
}
