import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { VIDEO_SCHEME } from '../../../shared/player'
import { contentType, parseRange, tokenFromUrl } from './videoRequest'
import type { VideoSources } from './videoSources'

/**
 * Serves the file behind a load token to the `<video>` element (PROJECT.md §4).
 *
 * The page asks for `fsvideo://file/<token>` and never for a path, so this is the only thing that
 * decides which bytes it gets. Range requests are answered properly because seeking depends on
 * them, and because without them Chromium re-reads large files from the start.
 *
 * Read-only by construction: it opens a read stream and nothing else (§2.1).
 */

/** Must run before the app is ready, which is why it is separate from serving. */
export function registerVideoScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: VIDEO_SCHEME,
      privileges: {
        // A standard scheme gets a real origin, which is what lets the CSP name it. `stream` is
        // what makes ranged media work rather than buffering whole files.
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        // Nothing here should be reachable from anywhere but our own page.
        corsEnabled: false
      }
    }
  ])
}

/** Starts answering video requests. Call once, after the app is ready. */
export function serveVideo(sources: VideoSources): void {
  protocol.handle(VIDEO_SCHEME, (request) => respond(sources, request))
}

async function respond(sources: VideoSources, request: Request): Promise<Response> {
  const token = tokenFromUrl(request.url)
  if (token === null) return new Response('Bad video request', { status: 400 })

  const path = sources.get(token)
  // A token for a load that has already been replaced, or one we never issued.
  if (path === null) return new Response('No such video', { status: 404 })

  let size: number
  try {
    const info = await stat(path)
    if (!info.isFile()) return new Response('Not a file', { status: 404 })
    size = info.size
  } catch {
    // The drive was unplugged, or the file was moved or deleted while it was playing.
    return new Response('Video unavailable', { status: 404 })
  }

  const range = parseRange(request.headers.get('Range'), size)
  const type = contentType(path)

  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' }
    })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? Math.max(0, size - 1)
  const length = size === 0 ? 0 : end - start + 1

  const headers: Record<string, string> = {
    'Content-Type': type,
    'Content-Length': String(length),
    'Accept-Ranges': 'bytes',
    // Nothing here should outlive the session it belongs to.
    'Cache-Control': 'no-store'
  }
  if (range !== null) headers['Content-Range'] = `bytes ${start}-${end}/${size}`

  // A HEAD only ever wants the headers, and opening a stream for one would leak a handle.
  if (request.method === 'HEAD' || length === 0) {
    return new Response(null, { status: range === null ? 200 : 206, headers })
  }

  const stream = createReadStream(path, { start, end })
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: range === null ? 200 : 206,
    headers
  })
}
