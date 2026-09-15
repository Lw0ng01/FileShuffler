import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ShuffleSession } from '../domain/shuffle'
import type { FileIdentity } from '../files/fileIdentity'
import { FakePlayer } from '../playback/fakePlayer'
import { ShuffleCoordinator, type CoordinatorState } from './coordinator'

interface Setup {
  player: FakePlayer
  coordinator: ShuffleCoordinator
  /** Fake file system: path → identity. A missing path means no file exists there. */
  files: Map<string, FileIdentity>
  trash: Mock<(path: string) => Promise<void>>
}

function identity(ino: number): FileIdentity {
  return { isFile: true, dev: 1n, ino: BigInt(ino), size: 1000n, mtimeNs: 1n }
}

function setup(items: string[]): Setup {
  const player = new FakePlayer()
  const files = new Map(items.map((id, index) => [`/videos/${id}`, identity(index + 1)]))
  const trash = vi.fn(async (path: string) => {
    files.delete(path)
  })
  const coordinator = new ShuffleCoordinator({
    session: new ShuffleSession(items, { random: () => 0 }),
    player,
    resolvePath: (id) => `/videos/${id}`,
    trash,
    identify: async (path) => files.get(path) ?? null
  })
  return { player, coordinator, files, trash }
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

  it('connects a new player after the old one exits and resumes the current file', () => {
    const { player, coordinator } = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    coordinator.next()
    const current = coordinator.getState().current
    player.emit({ type: 'exited', reason: 'window closed' })

    const replacement = new FakePlayer()
    coordinator.replacePlayer(replacement)
    expect(coordinator.getState()).toMatchObject({ status: 'idle', current })

    coordinator.resume()
    expect(replacement.loads).toEqual([{ token: 1, path: `/videos/${current}` }])

    player.emit({ type: 'ended', token: 1 })
    expect(replacement.loads).toHaveLength(1)
    replacement.emit({ type: 'loaded', token: 1 })
    expect(coordinator.getState().status).toBe('playing')
  })

  it('only replaces a player that has exited', () => {
    const { coordinator } = setup(['a.mkv'])
    coordinator.next()
    expect(() => coordinator.replacePlayer(new FakePlayer())).toThrow(
      'Only a player that has exited can be replaced'
    )
  })

  it('resume starts the shuffle when nothing has played, and does nothing while loading', () => {
    const { player, coordinator } = setup(['a.mkv', 'b.mkv'])
    coordinator.resume()
    expect(player.loads).toHaveLength(1)
    coordinator.resume()
    expect(player.loads).toHaveLength(1)
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

describe('ShuffleCoordinator deletes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Starts playback, confirms the first file opened, and returns its ID. */
  function playFirst({ player, coordinator }: Setup): string {
    coordinator.next()
    player.emit({ type: 'loaded', token: player.lastToken })
    return coordinator.getState().current as string
  }

  /** The next file opened, which means the player has let go of the previous one. */
  function openNext({ player }: Setup): void {
    player.emit({ type: 'loaded', token: player.lastToken })
  }

  /** Lets pending promise chains (identity checks, trash) run to completion. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }

  it('hides the current file, moves on, and trashes it when the undo window ends', async () => {
    const s = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    const doomed = playFirst(s)
    s.coordinator.deleteCurrent()

    const state = s.coordinator.getState()
    expect(state.current).not.toBe(doomed)
    expect(state.stats.total).toBe(2)
    expect(state.pendingDeletes).toEqual([{ id: doomed, deadline: Date.now() + 5000 }])
    openNext(s)

    await vi.advanceTimersByTimeAsync(4999)
    await settle()
    expect(s.trash).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(s.trash).toHaveBeenCalledTimes(1)
    expect(s.trash).toHaveBeenCalledWith(`/videos/${doomed}`)
    expect(s.coordinator.getState()).toMatchObject({ pendingDeletes: [], stats: { total: 2 } })
  })

  it('keeps the file and makes it playable again when the delete is undone', async () => {
    const s = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    const doomed = playFirst(s)
    s.coordinator.deleteCurrent()
    openNext(s)

    s.coordinator.undoDelete(doomed)
    expect(s.coordinator.getState()).toMatchObject({ pendingDeletes: [], stats: { total: 3 } })

    await vi.advanceTimersByTimeAsync(10000)
    await settle()
    expect(s.trash).not.toHaveBeenCalled()

    s.coordinator.back()
    expect(s.coordinator.getState().current).toBe(doomed)
  })

  it('never trashes a file that changed during the undo window', async () => {
    const s = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    const doomed = playFirst(s)
    s.coordinator.deleteCurrent()
    openNext(s)
    await settle()

    s.files.set(`/videos/${doomed}`, identity(99))
    await vi.advanceTimersByTimeAsync(5000)
    await settle()

    expect(s.trash).not.toHaveBeenCalled()
    expect(s.coordinator.getState()).toMatchObject({
      lastError: `${doomed} could not be confirmed as the same file, so it was kept`,
      pendingDeletes: [],
      stats: { total: 3 }
    })
  })

  it('keeps the file and explains why when trashing fails', async () => {
    const s = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    s.trash.mockRejectedValueOnce(new Error('the Recycle Bin is not available on this drive'))
    const doomed = playFirst(s)
    s.coordinator.deleteCurrent()
    openNext(s)

    await vi.advanceTimersByTimeAsync(5000)
    await settle()

    expect(s.trash).toHaveBeenCalledTimes(1)
    expect(s.coordinator.getState()).toMatchObject({
      lastError: `Could not move ${doomed} to the trash: the Recycle Bin is not available on this drive`,
      pendingDeletes: [],
      stats: { total: 3 }
    })
  })

  it('forgets a file that already disappeared, without trashing anything', async () => {
    const s = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    const doomed = playFirst(s)
    s.coordinator.deleteCurrent()
    openNext(s)
    await settle()

    s.files.delete(`/videos/${doomed}`)
    await vi.advanceTimersByTimeAsync(5000)
    await settle()

    expect(s.trash).not.toHaveBeenCalled()
    expect(s.coordinator.getState()).toMatchObject({ lastError: null, stats: { total: 2 } })
  })

  it('waits for the player to move past the file before trashing it', async () => {
    const s = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    const doomed = playFirst(s)
    s.coordinator.deleteCurrent()

    await vi.advanceTimersByTimeAsync(5000)
    await settle()
    expect(s.trash).not.toHaveBeenCalled()

    openNext(s)
    await vi.advanceTimersByTimeAsync(1000)
    await settle()
    expect(s.trash).toHaveBeenCalledWith(`/videos/${doomed}`)
  })

  it('keeps the file if the player never lets go of it', async () => {
    const s = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    const doomed = playFirst(s)
    s.coordinator.deleteCurrent()

    await vi.advanceTimersByTimeAsync(5000 + 10 * 1000)
    await settle()

    expect(s.trash).not.toHaveBeenCalled()
    expect(s.coordinator.getState()).toMatchObject({
      lastError: `${doomed} is still open in the player, so it was not deleted`,
      stats: { total: 3 }
    })
  })

  it('stops the player when it deletes the last playable file, then trashes it', async () => {
    const s = setup(['only.mkv'])
    const doomed = playFirst(s)
    s.coordinator.deleteCurrent()

    expect(s.coordinator.getState().status).toBe('finished')
    expect(s.player.unloads).toBe(1)
    await settle()

    await vi.advanceTimersByTimeAsync(5000)
    await settle()
    expect(s.trash).toHaveBeenCalledWith(`/videos/${doomed}`)
  })

  it('deletes the current file when Delete is pressed inside the player', () => {
    const s = setup(['a.mkv', 'b.mkv'])
    const doomed = playFirst(s)
    s.player.emit({ type: 'command', command: 'delete' })
    expect(s.coordinator.getState().pendingDeletes.map((entry) => entry.id)).toEqual([doomed])
  })

  it('does nothing when there is no current file', async () => {
    const s = setup(['a.mkv'])
    s.coordinator.deleteCurrent()
    await vi.advanceTimersByTimeAsync(10000)
    expect(s.coordinator.getState().pendingDeletes).toEqual([])
    expect(s.trash).not.toHaveBeenCalled()
  })

  it('keeps a pending delete when the player is replaced, then trashes the file', async () => {
    const s = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    const doomed = playFirst(s)
    s.coordinator.deleteCurrent()
    s.player.emit({ type: 'exited', reason: 'window closed' })
    s.coordinator.replacePlayer(new FakePlayer())
    expect(s.coordinator.getState().pendingDeletes.map((entry) => entry.id)).toEqual([doomed])

    await vi.advanceTimersByTimeAsync(5000)
    await settle()
    expect(s.trash).toHaveBeenCalledWith(`/videos/${doomed}`)
  })

  it('cancels deletes still in the undo window when disposed, and never replays them', async () => {
    const s = setup(['a.mkv', 'b.mkv', 'c.mkv'])
    playFirst(s)
    s.coordinator.deleteCurrent()
    openNext(s)

    s.coordinator.dispose()
    await vi.advanceTimersByTimeAsync(10000)
    await settle()
    expect(s.trash).not.toHaveBeenCalled()
  })
})
