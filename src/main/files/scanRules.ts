import { homedir } from 'node:os'
import { extname } from 'node:path'
import { VIDEO_EXTENSIONS } from './videoFolder'

/**
 * What the indexer collects (PROJECT.md §7 Phase 3). An allowlist, never a blocklist (§2.4): only
 * personal media and documents, so system and program files stay out of the dashboard.
 */
export type Category = 'video' | 'photo' | 'audio' | 'document'

export const PHOTO_EXTENSIONS: ReadonlySet<string> = new Set([
  '.avif',
  '.bmp',
  '.cr2',
  '.dng',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.nef',
  '.png',
  '.raf',
  '.svg',
  '.tif',
  '.tiff',
  '.webp'
])

export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  '.aac',
  '.aiff',
  '.flac',
  '.m4a',
  '.mp3',
  '.oga',
  '.ogg',
  '.opus',
  '.wav',
  '.wma'
])

export const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.csv',
  '.doc',
  '.docx',
  '.epub',
  '.key',
  '.md',
  '.numbers',
  '.odp',
  '.ods',
  '.odt',
  '.pages',
  '.pdf',
  '.ppt',
  '.pptx',
  '.rtf',
  '.txt',
  '.xls',
  '.xlsx'
])

/** The category for a file name, or null when it isn't indexed at all. */
export function categoryOf(name: string): Category | null {
  const extension = extname(name).toLowerCase()
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (PHOTO_EXTENSIONS.has(extension)) return 'photo'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document'
  return null
}

/**
 * Folder names skipped wherever they appear (PROJECT.md §2.5). Lowercase. These hold system,
 * program or cache data rather than personal files, and `appdata` in particular is full of
 * junctions that can loop forever.
 */
const SKIPPED_NAMES: ReadonlySet<string> = new Set([
  '$recycle.bin',
  '$windows.~bt',
  '$windows.~ws',
  '.git',
  '__pycache__',
  'appdata',
  'node_modules',
  // Program installs on any drive, not just the system drive: measured on Lucas's second drive,
  // 99% of the folders a scan walked were programs and games (PROJECT.md §7 measure and harden).
  'program files',
  'program files (x86)',
  'site-packages',
  'steamapps',
  'system volume information',
  'windowsapps'
])

/**
 * A folder holding one of these files is a tool's working folder, not somewhere people keep
 * media, so neither it nor anything inside is scanned. `pyvenv.cfg` marks a Python virtual
 * environment: 24 of them made up 82% of the folders under Lucas's Documents.
 */
export const SKIP_MARKER_FILES: ReadonlySet<string> = new Set(['pyvenv.cfg'])

export interface SkipRules {
  /** Absolute paths that are never indexed, along with everything inside them. */
  prefixes: readonly string[]
  /**
   * Folders the user chose to leave out in Settings, for example a game library with a name the
   * built-in rules can't know. Skipped exactly like `prefixes`, but reported differently.
   */
  excluded?: readonly string[]
  caseInsensitive: boolean
}

/** The system locations to skip on this platform (PROJECT.md §2.5). */
export function systemSkipRules(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir()
): SkipRules {
  if (platform === 'win32') {
    const system = process.env['SystemDrive'] ?? 'C:'
    return {
      caseInsensitive: true,
      prefixes: [
        `${system}\\Windows`,
        `${system}\\Program Files`,
        `${system}\\Program Files (x86)`,
        `${system}\\ProgramData`,
        `${home}\\AppData`
      ]
    }
  }
  return {
    caseInsensitive: platform === 'darwin',
    prefixes: [
      '/System',
      '/Library',
      '/Applications',
      '/private',
      '/bin',
      '/usr',
      `${home}/Library`
    ]
  }
}

function normalize(path: string, caseInsensitive: boolean): string {
  const forward = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return caseInsensitive ? forward.toLowerCase() : forward
}

/** True when `path` is `folder` itself or anywhere inside it. `D:\Games2` is not inside `D:\Games`. */
export function isInsideFolder(path: string, folder: string, caseInsensitive: boolean): boolean {
  const inner = normalize(path, caseInsensitive)
  const outer = normalize(folder, caseInsensitive)
  return inner === outer || inner.startsWith(`${outer}/`)
}

/** True when a folder is, or is inside, one the user excluded in Settings. */
export function isExcluded(fullPath: string, rules: SkipRules): boolean {
  return (rules.excluded ?? []).some((folder) =>
    isInsideFolder(fullPath, folder, rules.caseInsensitive)
  )
}

/**
 * True when a folder must not be opened: a system location, a dot-folder, one of the names above,
 * or a folder excluded in Settings. Applies to chosen roots as well, so picking `C:\Windows` still
 * indexes nothing.
 */
export function shouldSkipFolder(fullPath: string, name: string, rules: SkipRules): boolean {
  if (name.startsWith('.')) return true
  if (SKIPPED_NAMES.has(name.toLowerCase())) return true
  if (isExcluded(fullPath, rules)) return true
  return rules.prefixes.some((prefix) => isInsideFolder(fullPath, prefix, rules.caseInsensitive))
}
