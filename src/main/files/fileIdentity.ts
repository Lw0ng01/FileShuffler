import { lstat } from 'node:fs/promises'

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
 * The identity of whatever is at `path`, without following links. Resolves null only when nothing
 * exists there; rejects on any other error (a disconnected drive, missing permission), so callers
 * treat those as "can't tell".
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
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
