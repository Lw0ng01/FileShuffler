import type { PlaybackAdapter, PlaybackEvent } from './types'

/** Test double: records what it's asked to do and lets tests deliver player events by hand. */
export class FakePlayer implements PlaybackAdapter {
  readonly loads: { token: number; path: string }[] = []
  unloads = 0
  disposed = false
  private nextToken = 1
  private readonly listeners = new Set<(event: PlaybackEvent) => void>()

  load(path: string): number {
    const token = this.nextToken++
    this.loads.push({ token, path })
    return token
  }

  async unload(): Promise<void> {
    this.unloads += 1
  }

  onEvent(listener: (event: PlaybackEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): Promise<void> {
    this.disposed = true
    return Promise.resolve()
  }

  emit(event: PlaybackEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  get lastToken(): number {
    return (this.loads[this.loads.length - 1] as { token: number }).token
  }
}
