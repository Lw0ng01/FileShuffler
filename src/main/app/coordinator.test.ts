import { describe, expect, it } from 'vitest'
import { ShuffleSession } from '../domain/shuffle'
import type { PlaybackAdapter, PlaybackEvent } from '../playback/types'
import { ShuffleCoordinator, type CoordinatorState } from './coordinator'

/** Records what the coordinator asks for and lets tests deliver player events by hand. */
class FakePlayer implements PlaybackAdapter {
  readonly loads: { token: number; path: string }[] = []
  unloads = 0
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
    return Promise.resolve()
  }

  emit(event: PlaybackEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  get lastToken(): number {
    return (this.loads[this.loads.length - 1] as { token: number }).token
  }
}

function setup(items: string[]): { player: FakePlayer; coordinator: ShuffleCoordinator } {
  const player = new FakePlayer()
  const coordinator = new ShuffleCoordinator({
    session: new ShuffleSession(items, { random: () => 0 }),
    player,
    resolvePath: (id) => `/videos/${id}`
  })
  return { player, coordinator }
}

describe('ShuffleCoordinator', () => {
  it('loads the resolved path and counts coverage once the player confirms', () => {
    const { player, coordinator } = setup(['a.mkv', 'b.mkv'])
    coordinator.next()

    const { current, status } = coordinator.getState()
    expect(status).toBe('loading')
    expect(player.loads).toEqual([{ token: 1, path: `/videos/${current}` }])
    expect(coordinator.getState().stats.opened).toBe(0)

    player.emit({ type: 'loaded', token: 1 })
    expect(coordinator.getState()).toMatchObject({ status: 'playing', stats: { opened: 1 } })
  })

  it('plays the next file when the current one ends', () => {
    const { player, coordinator } = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    coordinator.next()
    const first = coordinator.getState().current
    player.emit({ type: 'loaded', token: 1 })
    player.emit({ type: 'ended', token: 1 })

    expect(player.loads).toHaveLength(2)
    expect(coordinator.getState().current).not.toBe(first)
    expect(coordinator.getState().status).toBe('loading')
  })

  it('ignores late events from a load that was replaced by rapid navigation', () => {
    const { player, coordinator } = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    coordinator.next()
    coordinator.next()
    const current = coordinator.getState().current

    player.emit({ type: 'ended', token: 1 })
    player.emit({ type: 'loaded', token: 1 })
    player.emit({ type: 'failed', token: 1, reason: 'stale' })

    expect(player.loads).toHaveLength(2)
    expect(coordinator.getState()).toMatchObject({
      status: 'loading',
      current,
      lastError: null,
      stats: { opened: 0, failed: 0 }
    })
  })

  it('skips a file that fails and clears the error once another file opens', () => {
    const { player, coordinator } = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    coordinator.next()
    const broken = coordinator.getState().current
    player.emit({ type: 'failed', token: 1, reason: 'unsupported codec' })

    expect(player.loads).toHaveLength(2)
    expect(coordinator.getState().stats.failed).toBe(1)
    expect(coordinator.getState().lastError).toBe(`Could not play ${broken}: unsupported codec`)

    player.emit({ type: 'loaded', token: 2 })
    expect(coordinator.getState()).toMatchObject({ status: 'playing', lastError: null })
  })

  it('stops the player instead of looping when every file fails', () => {
    const { player, coordinator } = setup(['a.mkv', 'b.mkv'])
    coordinator.next()
    player.emit({ type: 'failed', token: 1, reason: 'broken' })
    player.emit({ type: 'failed', token: 2, reason: 'broken' })

    expect(player.loads).toHaveLength(2)
    expect(player.unloads).toBe(1)
    expect(coordinator.getState()).toMatchObject({ status: 'finished', current: null })
  })

  it('finishes straight away for an empty folder', () => {
    const { player, coordinator } = setup([])
    coordinator.next()
    expect(player.loads).toHaveLength(0)
    expect(coordinator.getState().status).toBe('finished')
  })

  it('goes back to the previous file, and stays put at the start of history', () => {
    const { player, coordinator } = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    coordinator.next()
    const first = coordinator.getState().current
    coordinator.next()

    coordinator.back()
    expect(coordinator.getState().current).toBe(first)
    expect(player.loads[2]?.path).toBe(`/videos/${first}`)

    coordinator.back()
    expect(player.loads).toHaveLength(3)
    expect(coordinator.getState().current).toBe(first)
  })

  it('follows next and back commands sent from inside the player', () => {
    const { player, coordinator } = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    coordinator.next()
    const first = coordinator.getState().current

    player.emit({ type: 'command', command: 'next' })
    expect(player.loads).toHaveLength(2)

    player.emit({ type: 'command', command: 'back' })
    expect(coordinator.getState().current).toBe(first)
    expect(player.loads).toHaveLength(3)
  })

  it('stops issuing commands after the player exits', () => {
    const { player, coordinator } = setup(['a.mkv', 'b.mkv'])
    coordinator.next()
    player.emit({ type: 'exited', reason: 'window closed' })

    coordinator.next()
    coordinator.back()
    player.emit({ type: 'ended', token: 1 })

    expect(player.loads).toHaveLength(1)
    expect(coordinator.getState()).toMatchObject({
      status: 'player-exited',
      lastError: 'Player exited: window closed'
    })
  })

  it('notifies state listeners and stops reacting after dispose', () => {
    const { player, coordinator } = setup(['a.mkv', 'b.mkv'])
    const seen: CoordinatorState[] = []
    coordinator.onState((state) => seen.push(state))

    coordinator.next()
    player.emit({ type: 'loaded', token: 1 })
    expect(seen.map((state) => state.status)).toEqual(['loading', 'playing'])

    coordinator.dispose()
    player.emit({ type: 'ended', token: 1 })
    expect(player.loads).toHaveLength(1)
    expect(seen).toHaveLength(2)
  })
})
