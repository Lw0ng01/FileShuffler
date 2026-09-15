import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface FindMpvOptions {
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  /** Electron's `process.resourcesPath` in a packaged app; null during development. */
  resourcesPath: string | null
  exists?: (path: string) => boolean
}

/** Where apps started from Finder look for a Homebrew or app-bundle mpv; they don't get the shell PATH. */
const MAC_CANDIDATES = [
  '/opt/homebrew/bin/mpv',
  '/usr/local/bin/mpv',
  '/Applications/mpv.app/Contents/MacOS/mpv'
]

/**
 * The mpv program to start, in order of preference:
 * 1. `FILESHUFFLER_MPV`, for development and testing
 * 2. a copy bundled with the packaged app, in `resources/mpv/` (Phase 1 packaging)
 * 3. common macOS install locations
 * 4. `mpv` on the PATH
 */
export function findMpv(options: FindMpvOptions): string {
  const exists = options.exists ?? existsSync
  const override = options.env['FILESHUFFLER_MPV']
  if (override) return override

  const executable = options.platform === 'win32' ? 'mpv.exe' : 'mpv'
  if (options.resourcesPath !== null) {
    const bundled = join(options.resourcesPath, 'mpv', executable)
    if (exists(bundled)) return bundled
  }
  if (options.platform === 'darwin') {
    const installed = MAC_CANDIDATES.find((candidate) => exists(candidate))
    if (installed !== undefined) return installed
  }
  return executable
}
