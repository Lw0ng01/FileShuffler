import { statfs } from 'node:fs/promises'

export interface DriveSpace {
  /** Capacity of the drive in bytes. */
  total: number
  /** Bytes still available to this user. */
  free: number
}

/**
 * How big a drive is and how much is left, for the dashboard's drive cards (PROJECT.md §7 Phase 4).
 * The index only knows what it catalogued; free space has to come from the filesystem.
 *
 * Read-only, and resolves null instead of throwing: a drive can be unplugged or refuse the call at
 * any moment, and a missing figure must never break the dashboard.
 */
export async function readDriveSpace(path: string): Promise<DriveSpace | null> {
  try {
    const stats = await statfs(path)
    const blockSize = Number(stats.bsize)
    const total = Number(stats.blocks) * blockSize
    // `bavail` is what an ordinary user may use, which is what "free" means on a drive card.
    const free = Number(stats.bavail) * blockSize
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free)) return null
    return { total, free: Math.max(0, free) }
  } catch {
    return null
  }
}
