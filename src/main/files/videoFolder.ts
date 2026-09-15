import { readdir } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'

/**
 * Extensions treated as videos: an allowlist, not a blocklist (PROJECT.md §2.4). Lowercase.
 * `.ts` and `.mts` are deliberately left out: they are also TypeScript source files, and a
 * shuffle folder's files can be deleted.
 */
export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  '.3gp',
  '.avi',
  '.flv',
  '.m2ts',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.ogv',
  '.webm',
  '.wmv'
])

/**
 * Lists the video files directly inside `folder` (PROJECT.md §3: top level only). Read-only.
 * Skips subfolders, symbolic links and junctions, hidden dot-files, and anything not on the
 * allowlist. Names come back sorted so the starting list is stable; the shuffle randomizes it.
 */
export async function listVideoFiles(folder: string): Promise<string[]> {
  if (!isAbsolute(folder)) throw new Error(`Expected an absolute folder path, got "${folder}"`)
  const entries = await readdir(folder, { withFileTypes: true })
  return entries
    .filter(
      (entry) =>
        // isFile() is false for links and junctions, so they are never followed.
        entry.isFile() &&
        !entry.name.startsWith('.') &&
        VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
}
