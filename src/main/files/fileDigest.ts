import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'

/**
 * Bytes read from each end. Two different videos of exactly the same size almost always differ in
 * their header or their tail, and reading 128 KiB is fast even on a slow external drive.
 */
const EDGE_BYTES = 64 * 1024

/**
 * A fingerprint of a file from its size and the bytes at each end, for confirming that files which
 * merely *look* alike really are copies (PROJECT.md §7 Phase 5).
 *
 * This is deliberately not a whole-file hash: hashing a folder of films end to end would take
 * minutes and hammer the disk. Matching fingerprints mean "identical as far as this checks", which
 * the UI has to say plainly, and different fingerprints are conclusive: those files differ.
 *
 * Read-only, and resolves null rather than throwing when a file can't be read, so one locked file
 * doesn't sink a whole comparison.
 */
export async function fileDigest(path: string): Promise<string | null> {
  let handle
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    const hash = createHash('sha256')
    hash.update(String(size))

    const head = Buffer.alloc(Math.min(EDGE_BYTES, size))
    if (head.length > 0) {
      const read = await handle.read(head, 0, head.length, 0)
      hash.update(head.subarray(0, read.bytesRead))
    }

    // Only worth reading the tail when it isn't part of what was just read.
    if (size > EDGE_BYTES) {
      const tailLength = Math.min(EDGE_BYTES, size - EDGE_BYTES)
      const tail = Buffer.alloc(tailLength)
      const read = await handle.read(tail, 0, tailLength, size - tailLength)
      hash.update(tail.subarray(0, read.bytesRead))
    }

    return hash.digest('hex')
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
