import { extname } from 'node:path'

/**
 * The parts of serving a video that are worth testing on their own: which token was asked for, and
 * which slice of the file a range request means. Kept free of Electron and the filesystem so the
 * awkward cases - a seek past the end, an open-ended range, a byte count of zero - are covered by
 * ordinary tests rather than by trying it and watching.
 */

/** The token in `fsvideo://file/<token>`, or null when the URL is not one of ours. */
export function tokenFromUrl(url: string): number | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const raw = parsed.pathname.replace(/^\/+/, '')
  if (!/^\d+$/.test(raw)) return null
  const token = Number(raw)
  return Number.isSafeInteger(token) && token > 0 ? token : null
}

export interface ByteRange {
  start: number
  /** Inclusive, as HTTP ranges are. */
  end: number
}

/**
 * Reads a `Range` header against a known file size.
 *
 * - `null` means no range was asked for: send the whole file.
 * - `'unsatisfiable'` means the range falls outside the file, which has its own status code; a
 *   player that seeks to the very end hits this, so it must not be treated as a broken request.
 */
export function parseRange(
  header: string | null,
  size: number
): ByteRange | null | 'unsatisfiable' {
  if (header === null || header.trim() === '') return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return null

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  // `bytes=-500` means the last 500 bytes, not "up to 500".
  if (rawStart === '') {
    const wanted = Number(rawEnd)
    if (wanted <= 0) return 'unsatisfiable'
    const start = Math.max(0, size - wanted)
    return size === 0 ? 'unsatisfiable' : { start, end: size - 1 }
  }

  const start = Number(rawStart)
  if (start >= size) return 'unsatisfiable'
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (end < start) return 'unsatisfiable'
  return { start, end }
}

/**
 * What to tell the page a file is.
 *
 * `.mov` and `.m4v` are deliberately served as `video/mp4`: Chromium answers "no" to
 * `canPlayType('video/quicktime')` while playing the same file quite happily, so the honest MIME
 * type would turn away files that work (PROJECT.md §4).
 */
export function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.webm':
      return 'video/webm'
    case '.ogv':
      return 'video/ogg'
    default:
      return 'video/mp4'
  }
}
