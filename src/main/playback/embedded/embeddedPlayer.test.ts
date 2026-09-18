import { describe, expect, it, vi } from 'vitest'
import type { PlayerCommandMessage, PlayerEventMessage } from '../../../shared/player'
import type { PlaybackEvent } from '../types'
import { EmbeddedPlayer, type PlayerTransport } from './embeddedPlayer'

/** Stands in for the renderer: records what it was told, and lets a test answer back. */
function fakeTransport(options: { live?: boolean } = {}): PlayerTransport & {
  sent: PlayerCommandMessage[]
  sources: Map<number, string>
  cleared: number
  reply: (message: PlayerEventMessage) => void
  live: boolean
} {
  const listeners = new Set<(message: PlayerEventMessage) => void>()
  return {
    sent: [],
    sources: new Map(),
    cleared: 0,
    live: options.live ?? true,
    isLive(): boolean {
      return this.live
    },
    send(command): void {
      this.sent.push(command)
    },
    onMessage(listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setSource(token, path): void {
      this.sources.set(token, path)
    },
    clearSources(): void {
      this.cleared += 1
      this.sources.clear()
    },
    reply(message): void {
      for (const listener of [...listeners]) listener(message)
    }
  }
}

function collect(player: EmbeddedPlayer): PlaybackEvent[] {
  const events: PlaybackEvent[] = []
  player.onEvent((event) => events.push(event))
  return events
}

describe('EmbeddedPlayer', () => {
  it('gives every load its own increasing token, and points the token at the file first', () => {
    const transport = fakeTransport()
    const player = new EmbeddedPlayer({ transport })

    const first = player.load('C:/videos/a.mp4')
    const second = player.load('C:/videos/b.mp4')

    expect(second).toBeGreaterThan(first)
    // The renderer is only ever told the token, never the path.
    expect(transport.sent).toEqual([
      { type: 'load', token: first },
      { type: 'load', token: second }
    ])
    expect(transport.sources.get(first)).toBe('C:/videos/a.mp4')
    expect(transport.sources.get(second)).toBe('C:/videos/b.mp4')
  })

  it('reports the renderer\u2019s events as playback events', () => {
    const transport = fakeTransport()
    const player = new EmbeddedPlayer({ transport })
    const events = collect(player)
    const token = player.load('C:/videos/a.mp4')

    transport.reply({ type: 'loaded', token })
    transport.reply({ type: 'ended', token })

    expect(events).toEqual([
      { type: 'loaded', token },
      { type: 'ended', token }
    ])
  })

  it('passes a failure through rather than throwing at the caller', () => {
    const transport = fakeTransport()
    const player = new EmbeddedPlayer({ transport })
    const events = collect(player)
    const token = player.load('C:/videos/a.mp4')

    transport.reply({ type: 'failed', token, reason: 'DEMUXER_ERROR' })

    expect(events).toEqual([{ type: 'failed', token, reason: 'DEMUXER_ERROR' }])
  })

  it('fails the load when there is no window, instead of hanging', async () => {
    const transport = fakeTransport({ live: false })
    const player = new EmbeddedPlayer({ transport })
    const events = collect(player)

    const token = player.load('C:/videos/a.mp4')
    await Promise.resolve()

    expect(transport.sent).toEqual([])
    expect(events).toEqual([{ type: 'failed', token, reason: 'The window is not open.' }])
  })

  it('resolves unload only once the renderer says the file is released', async () => {
    const transport = fakeTransport()
    const player = new EmbeddedPlayer({ transport })
    player.load('C:/videos/a.mp4')

    let released = false
    const pending = player.unload().then(() => {
      released = true
    })
    await Promise.resolve()
    expect(released).toBe(false)

    const request = transport.sent.find((message) => message.type === 'unload')
    expect(request).toBeDefined()
    transport.reply({ type: 'unloaded', requestId: (request as { requestId: number }).requestId })
    await pending

    expect(released).toBe(true)
  })

  it('gives up waiting for the renderer rather than stalling a delete', async () => {
    vi.useFakeTimers()
    try {
      const transport = fakeTransport()
      const player = new EmbeddedPlayer({ transport, unloadTimeoutMs: 50 })
      player.load('C:/videos/a.mp4')

      let released = false
      const pending = player.unload().then(() => {
        released = true
      })
      await vi.advanceTimersByTimeAsync(49)
      expect(released).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await pending
      expect(released).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers a late reply for an unload that already timed out without throwing', async () => {
    vi.useFakeTimers()
    try {
      const transport = fakeTransport()
      const player = new EmbeddedPlayer({ transport, unloadTimeoutMs: 10 })
      player.load('C:/videos/a.mp4')
      const pending = player.unload()
      await vi.advanceTimersByTimeAsync(10)
      await pending

      const request = transport.sent.find((message) => message.type === 'unload')
      expect(() =>
        transport.reply({
          type: 'unloaded',
          requestId: (request as { requestId: number }).requestId
        })
      ).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases the file and forgets every token when disposed', async () => {
    const transport = fakeTransport()
    const player = new EmbeddedPlayer({ transport })
    const events = collect(player)
    player.load('C:/videos/a.mp4')

    const disposing = player.dispose()
    const request = transport.sent.find((message) => message.type === 'unload')
    transport.reply({ type: 'unloaded', requestId: (request as { requestId: number }).requestId })
    await disposing

    expect(transport.cleared).toBe(1)
    expect(transport.sources.size).toBe(0)
    expect(events.at(-1)).toEqual({
      type: 'exited',
      reason: 'The built-in player was closed.'
    })
  })

  it('is safe to dispose twice', async () => {
    const transport = fakeTransport({ live: false })
    const player = new EmbeddedPlayer({ transport })

    await player.dispose()
    await expect(player.dispose()).resolves.toBeUndefined()
  })

  it('ignores anything the renderer sends after disposal', async () => {
    const transport = fakeTransport({ live: false })
    const player = new EmbeddedPlayer({ transport })
    const events = collect(player)
    await player.dispose()
    events.length = 0

    transport.reply({ type: 'ended', token: 1 })

    expect(events).toEqual([])
  })
})
