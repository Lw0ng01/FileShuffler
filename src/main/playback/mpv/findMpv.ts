import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { MpvSource } from '../../../shared/settings'

export interface FindMpvOptions {
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  /** Electron's `process.resourcesPath` in a packaged app; null during development. */
  resourcesPath: string | null
  /** The program chosen in Settings, or null to find mpv automatically. */
  chosen?: string | null
  exists?: (path: string) => boolean
}

export interface MpvLocation {
  path: string
  source: MpvSource
}

/** Where apps started from Finder look for a Homebrew or app-bundle mpv; they don't get the shell PATH. */
const MAC_CANDIDATES = [
  '/opt/homebrew/bin/mpv',
  '/usr/local/bin/mpv',
  '/Applications/mpv.app/Contents/MacOS/mpv'
]

/**
 * The mpv program to start, and where it came from, in order of preference:
 * 1. `FILESHUFFLER_MPV`, for development and testing
 * 2. the program chosen in Settings, which beats anything the app finds by itself
 * 3. a copy bundled with the packaged app, in `resources/mpv/` (Phase 1 packaging)
 * 4. common macOS install locations
 * 5. `mpv` on the PATH
 */
export function locateMpv(options: FindMpvOptions): MpvLocation {
  const exists = options.exists ?? existsSync
  const override = options.env['FILESHUFFLER_MPV']
  if (override) return { path: override, source: 'environment' }
  if (options.chosen) return { path: options.chosen, source: 'settings' }

  const executable = options.platform === 'win32' ? 'mpv.exe' : 'mpv'
  if (options.resourcesPath !== null) {
    const bundled = join(options.resourcesPath, 'mpv', executable)
    if (exists(bundled)) return { path: bundled, source: 'bundled' }
  }
  if (options.platform === 'darwin') {
    const installed = MAC_CANDIDATES.find((candidate) => exists(candidate))
    if (installed !== undefined) return { path: installed, source: 'installed' }
  }
  return { path: executable, source: 'path' }
}

/** Just the program from `locateMpv`. */
export function findMpv(options: FindMpvOptions): string {
  return locateMpv(options).path
}
