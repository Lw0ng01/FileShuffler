import { readFile } from 'node:fs/promises'
import type { ShuffleSnapshot } from '../domain/shuffle'
import { writeJsonAtomic } from './atomicJson'

/** Bumped only if the saved shape changes; an older or unknown file is ignored, never migrated. */
const VERSION = 1
/** Folders remembered at once, newest last. Keeps the file small without a cleanup job. */
const MAX_FOLDERS = 20

interface StoredFolder {
  snapshot: ShuffleSnapshot
  updatedAt: number
}

interface StoredFile {
  version: number
  lastFolder: string | null
  folders: Record<string, StoredFolder>
}

/** What the shuffler needs from saved progress, so tests can pass a fake. */
export interface ProgressSource {
  read(folder: string): Promise<ShuffleSnapshot | null>
  save(folder: string, snapshot: ShuffleSnapshot): Promise<void>
  lastFolder(): Promise<string | null>
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/** Saved files are data, not trusted input: anything unexpected is dropped. */
function asSnapshot(value: unknown): ShuffleSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  const cycle = candidate['cycle']
  if (typeof cycle !== 'number' || !Number.isFinite(cycle)) return null
  if (!isStringArray(candidate['bag'])) return null
  if (!isStringArray(candidate['cycleDraws'])) return null
  if (!isStringArray(candidate['opened'])) return null
  return {
    cycle,
    bag: candidate['bag'],
    cycleDraws: candidate['cycleDraws'],
    opened: candidate['opened']
  }
}

function emptyFile(): StoredFile {
  return { version: VERSION, lastFolder: null, folders: {} }
}

/**
 * Remembers where each folder's shuffle cycle got to, so closing the app doesn't restart it
 * (PROJECT.md §3). One JSON file in the app's own data folder; nothing here touches the user's
 * files, and the file never leaves the machine (PROJECT.md §2.7–2.8).
 *
 * Losing this file only costs a cycle's progress, so every failure is survivable: a missing,
 * unreadable or corrupt file reads as "no progress" instead of stopping the app.
 */
export class ProgressStore implements ProgressSource {
  private readonly file: string
  private readonly maxFolders: number
  private cache: StoredFile | null = null
  /** Writes run one at a time, so two quick saves can't interleave. */
  private writes: Promise<void> = Promise.resolve()

  constructor(file: string, maxFolders: number = MAX_FOLDERS) {
    this.file = file
    this.maxFolders = Math.max(1, maxFolders)
  }

  async read(folder: string): Promise<ShuffleSnapshot | null> {
    const data = await this.load()
    return data.folders[folder]?.snapshot ?? null
  }

  async lastFolder(): Promise<string | null> {
    return (await this.load()).lastFolder
  }

  async save(folder: string, snapshot: ShuffleSnapshot): Promise<void> {
    const data = await this.load()
    // Re-inserting keeps the newest folder last, which is what prune() trims from the front.
    delete data.folders[folder]
    data.folders[folder] = { snapshot, updatedAt: Date.now() }
    data.lastFolder = folder
    const names = Object.keys(data.folders)
    for (const name of names.slice(0, Math.max(0, names.length - this.maxFolders))) {
      delete data.folders[name]
    }
    await this.write(data)
  }

  /** Forgets one folder, for example after the user restarts its cycle from scratch. */
  async forget(folder: string): Promise<void> {
    const data = await this.load()
    if (!(folder in data.folders)) return
    delete data.folders[folder]
    if (data.lastFolder === folder) data.lastFolder = null
    await this.write(data)
  }

  /** Forgets every folder's saved progress, and which folder was open last (§6 Settings). */
  async clearAll(): Promise<void> {
    this.cache = emptyFile()
    await this.write(this.cache)
  }

  private async load(): Promise<StoredFile> {
    this.cache ??= await this.readFile()
    return this.cache
  }

  private async readFile(): Promise<StoredFile> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch {
      return emptyFile()
    }
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null) return emptyFile()
      const candidate = parsed as Record<string, unknown>
      if (candidate['version'] !== VERSION) return emptyFile()
      const folders: Record<string, StoredFolder> = {}
      const saved = candidate['folders']
      if (typeof saved === 'object' && saved !== null) {
        for (const [folder, entry] of Object.entries(saved as Record<string, unknown>)) {
          if (typeof entry !== 'object' || entry === null) continue
          const snapshot = asSnapshot((entry as Record<string, unknown>)['snapshot'])
          const updatedAt = (entry as Record<string, unknown>)['updatedAt']
          if (snapshot === null) continue
          folders[folder] = { snapshot, updatedAt: typeof updatedAt === 'number' ? updatedAt : 0 }
        }
      }
      const lastFolder = candidate['lastFolder']
      return {
        version: VERSION,
        lastFolder: typeof lastFolder === 'string' ? lastFolder : null,
        folders
      }
    } catch {
      return emptyFile()
    }
  }

  /** Writes a temporary file and renames it, so a crash can never leave half a file behind. */
  private write(data: StoredFile): Promise<void> {
    this.writes = this.writes.catch(() => undefined).then(() => writeJsonAtomic(this.file, data))
    return this.writes
  }
}
