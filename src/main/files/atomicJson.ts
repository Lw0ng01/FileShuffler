import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Writes JSON to a temporary file beside the target and renames it into place. A crash or power
 * cut mid-write leaves either the old file or the new one, never half of one. Creates the folder
 * if it doesn't exist yet.
 */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  await writeFile(temporary, JSON.stringify(data), 'utf8')
  await rename(temporary, file)
}
