/**
 * What each load token points at (PROJECT.md §4). The renderer asks for a token; only this decides
 * which file that is, so the page never names a path and cannot ask for one it was not given
 * (`CLAUDE.md`: file actions resolve against the active session).
 *
 * Bounded on purpose. A shuffle runs for as long as the app is open, and one entry per load would
 * grow without limit; only the newest few can still be asked for, because a request for an older
 * token means a load that has already been replaced.
 */
const KEEP = 4

export class VideoSources {
  private readonly byToken = new Map<number, string>()

  set(token: number, path: string): void {
    this.byToken.set(token, path)
    while (this.byToken.size > KEEP) {
      const oldest = this.byToken.keys().next()
      if (oldest.done === true) break
      this.byToken.delete(oldest.value)
    }
  }

  get(token: number): string | null {
    return this.byToken.get(token) ?? null
  }

  /** Forgets every token, so nothing keeps pointing at a file once a session ends. */
  clear(): void {
    this.byToken.clear()
  }

  get size(): number {
    return this.byToken.size
  }
}
