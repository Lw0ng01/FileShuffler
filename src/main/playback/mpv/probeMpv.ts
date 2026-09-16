import { execFile, type ExecFileException } from 'node:child_process'

export type MpvProbe = { ok: true; version: string } | { ok: false; reason: string }

/** How long `mpv --version` may take before it counts as not working. */
const PROBE_TIMEOUT_MS = 5000

function describe(error: ExecFileException): string {
  if (String(error.code) === 'ENOENT') return 'No program was found at that location.'
  if (error.killed === true) return 'It did not answer within 5 seconds.'
  return error.message
}

/**
 * Runs `<program> --version` to check it really is a working mpv before the app relies on it, so
 * a wrong choice in Settings is caught there rather than when a shuffle fails to start.
 *
 * Started without a shell and with arguments as a list, like every mpv launch (PROJECT.md §4), and
 * stopped if it hangs. Resolves a readable reason instead of throwing.
 */
export function probeMpv(path: string): Promise<MpvProbe> {
  return new Promise((resolve) => {
    execFile(
      path,
      ['--version'],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024 },
      (error, stdout) => {
        const firstLine = String(stdout).split(/\r?\n/)[0]?.trim() ?? ''
        // Some builds exit non-zero after printing their version, so the output decides.
        if (firstLine.length === 0) {
          resolve({
            ok: false,
            reason: error === null ? 'It printed nothing.' : describe(error)
          })
          return
        }
        if (!/^mpv\b/i.test(firstLine)) {
          resolve({ ok: false, reason: "That program ran, but it isn't mpv." })
          return
        }
        resolve({ ok: true, version: firstLine })
      }
    )
  })
}
