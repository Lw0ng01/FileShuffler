import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShufflerView } from '../../shared/shuffler'
import type { ShuffleSnapshot } from '../domain/shuffle'
import type { ProgressSource } from '../files/progressStore'
import { FakePlayer } from '../playback/fakePlayer'
import type { PlaybackAdapter } from '../playback/types'
import { ShufflerService, type ShufflerServiceDeps } from './shufflerService'

interface Options {
  /** What the folder picker returns; null means cancelled. */
  folder?: string | null
  videos?: string[] | Error
  launchPlayer?: ShufflerServiceDeps['launchPlayer']
  progress?: ProgressSource
}

function setup(options: Options = {}): {
  service: ShufflerService
  deps: ShufflerServiceDeps
  players: FakePlayer[]
  trash: ReturnType<typeof vi.fn>
  views: ShufflerView[]
} {
  const players: FakePlayer[] = []
  const trash = vi.fn(async () => {})
  const deps: ShufflerServiceDeps = {
    pickFolder: vi.fn(async () => (options.folder === undefined ? '/videos' : options.folder)),
    listVideos: vi.fn(async () => {
      if (options.videos instanceof Error) throw options.videos
      return options.videos ?? ['a.mkv', 'b.mkv', 'c.mkv']
    }),
    launchPlayer:
      options.launchPlayer ??
      vi.fn(async (): Promise<PlaybackAdapter> => {
        const player = new FakePlayer()
        players.push(player)
        return player
      }),
    trash,
    identify: async () => ({ isFile: true, dev: 1n, ino: 1n, size: 1n, mtimeNs: 1n }),
    playerKeys: { next: '>', back: '<', delete: 'Del' },
    random: () => 0
  }
  if (options.progress !== undefined) deps.progress = options.progress
  const service = new ShufflerService(deps)
  const views: ShufflerView[] = []
  service.onView((view) => views.push(view))
  return { service, deps, players, trash, views }
}

/** Confirms the latest load opened, the way mpv would. */
function opened(player: FakePlayer | undefined): void {
  if (player === undefined) throw new Error('no player was started')
  player.emit({ type: 'loaded', token: player.lastToken })
}

afterEach(() => {
  vi.useRealTimers()
})

/** Saved progress in memory, standing in for the JSON file on disk. */
class FakeProgress implements ProgressSource {
  readonly saved = new Map<string, ShuffleSnapshot>()
  last: string | null = null

  async read(folder: string): Promise<ShuffleSnapshot | null> {
    return this.saved.get(folder) ?? null
  }

  async save(folder: string, snapshot: ShuffleSnapshot): Promise<void> {
    this.saved.set(folder, snapshot)
    this.last = folder
  }

  async lastFolder(): Promise<string | null> {
    return this.last
  }
}

describe('ShufflerService saved progress', () => {
  it('remembers where a folder’s cycle got to and continues it next time', async () => {
    const progress = new FakeProgress()
    const first = setup({ progress })
    await first.service.chooseFolder()
    await first.service.play()
    opened(first.players[0])
    const played = first.service.getView().current as string
    await first.service.next()
    opened(first.players[0])
    await first.service.dispose()

    expect(progress.saved.get('/videos')?.cycleDraws).toContain(played)

    const second = setup({ progress })
    await second.service.chooseFolder()
    expect(second.service.getView()).toMatchObject({ cycle: 1, total: 3, opened: 2 })
    await second.service.dispose()
  })

  it('reopens the last folder at startup, ready to play', async () => {
    const progress = new FakeProgress()
    const first = setup({ progress })
    await first.service.chooseFolder()
    await first.service.dispose()

    const second = setup({ progress })
    await second.service.restoreLastSession()
    expect(second.service.getView()).toMatchObject({
      folder: '/videos',
      status: 'ready',
      total: 3
    })
    await second.service.dispose()
  })

  it('ignores a saved folder that can no longer be read, for example an unplugged drive', async () => {
    const progress = new FakeProgress()
    progress.last = '/gone'
    const { service, deps } = setup({ progress, videos: new Error('ENOENT') })

    await service.restoreLastSession()
    expect(deps.listVideos).toHaveBeenCalledWith('/gone')
    expect(service.getView()).toMatchObject({ status: 'no-folder', folder: null })
  })

  it('restarts the cycle on request and saves the new one', async () => {
    const progress = new FakeProgress()
    const { service, players } = setup({ progress })
    await service.chooseFolder()
    await service.play()
    opened(players[0])
    expect(service.getView()).toMatchObject({ cycle: 1, opened: 1 })

    await service.restartCycle()
    expect(service.getView()).toMatchObject({ cycle: 2, opened: 0, total: 3 })
    expect(progress.saved.get('/videos')?.cycle).toBe(2)
    await service.dispose()
  })

  it('works without a progress store at all', async () => {
    const { service } = setup()
    await service.restoreLastSession()
    expect(service.getView().status).toBe('no-folder')
    await service.chooseFolder()
    await service.restartCycle()
    expect(service.getView()).toMatchObject({ status: 'ready', total: 3 })
    await service.dispose()
  })
})

describe('ShufflerService', () => {
  it('starts without a folder and stays that way when the picker is cancelled', async () => {
    const { service, deps } = setup({ folder: null })
    expect(service.getView()).toMatchObject({ status: 'no-folder', folder: null, total: 0 })

    await service.chooseFolder()
    expect(service.getView().status).toBe('no-folder')
    expect(deps.listVideos).not.toHaveBeenCalled()
  })

  it('reads the chosen folder without starting the player yet', async () => {
    const { service, deps } = setup()
    const view = await service.chooseFolder()

    expect(view).toMatchObject({ status: 'ready', folder: '/videos', total: 3, cycle: 1 })
    expect(deps.listVideos).toHaveBeenCalledWith('/videos')
    expect(deps.launchPlayer).not.toHaveBeenCalled()
  })

  it('reports a folder it cannot read and keeps the previous state', async () => {
    const { service } = setup({ videos: new Error('EACCES: permission denied') })
    await service.chooseFolder()
    expect(service.getView()).toMatchObject({
      status: 'no-folder',
      lastError: 'Could not read /videos: EACCES: permission denied'
    })
  })

  it('starts the player only once when Play is pressed twice quickly, then shuffles', async () => {
    const { service, deps, players } = setup()
    await service.chooseFolder()
    await Promise.all([service.play(), service.play()])

    expect(deps.launchPlayer).toHaveBeenCalledTimes(1)
    const view = service.getView()
    expect(view.status).toBe('loading')
    expect(players[0]?.loads).toEqual([{ token: 1, path: join('/videos', view.current as string) }])
  })

  it('explains when mpv is missing, and can try again', async () => {
    const players: FakePlayer[] = []
    const launchPlayer = vi
      .fn<ShufflerServiceDeps['launchPlayer']>()
      .mockRejectedValueOnce(new Error('mpv stopped before it was ready (spawn mpv ENOENT)'))
      .mockImplementation(async () => {
        const player = new FakePlayer()
        players.push(player)
        return player
      })
    const { service } = setup({ launchPlayer })
    await service.chooseFolder()

    await service.play()
    expect(service.getView()).toMatchObject({
      status: 'ready',
      lastError: "mpv wasn't found. Install mpv, or set FILESHUFFLER_MPV to the mpv program's path."
    })

    await service.play()
    expect(service.getView()).toMatchObject({ status: 'loading', lastError: null })
    expect(players).toHaveLength(1)
  })

  it('keeps the six most recently opened files, newest first', async () => {
    const { service, players } = setup({ videos: Array.from({ length: 8 }, (_, i) => `${i}.mkv`) })
    await service.chooseFolder()
    const seen: string[] = []

    await service.play()
    for (let i = 0; i < 8; i++) {
      opened(players[0])
      seen.unshift(service.getView().current as string)
      if (i < 7) await service.next()
    }

    expect(service.getView().recent).toEqual(seen.slice(0, 6))
  })

  it('reopens the player at the same file after its window was closed', async () => {
    const { service, deps, players } = setup()
    await service.chooseFolder()
    await service.play()
    opened(players[0])
    const current = service.getView().current as string

    players[0]?.emit({ type: 'exited', reason: 'window closed' })
    expect(service.getView().status).toBe('player-exited')

    await service.play()
    expect(deps.launchPlayer).toHaveBeenCalledTimes(2)
    expect(players[1]?.loads).toEqual([{ token: 1, path: join('/videos', current) }])
  })

  it('moves on when Next is pressed after the player window was closed', async () => {
    const { service, players } = setup()
    await service.chooseFolder()
    await service.play()
    opened(players[0])
    const current = service.getView().current as string
    players[0]?.emit({ type: 'exited', reason: 'window closed' })

    await service.next()
    expect(players[1]?.loads).toHaveLength(1)
    expect(players[1]?.loads[0]?.path).not.toBe(join('/videos', current))
  })

  it('will not change folders while a delete can still be undone', async () => {
    vi.useFakeTimers()
    const { service, deps, players } = setup()
    await service.chooseFolder()
    await service.play()
    opened(players[0])
    const doomed = service.getView().current as string

    await service.deleteCurrent()
    await service.chooseFolder()
    expect(deps.pickFolder).toHaveBeenCalledTimes(1)
    expect(service.getView()).toMatchObject({
      folder: '/videos',
      lastError: 'Undo or wait for the pending delete before changing folders.'
    })

    expect(await service.undoDelete(doomed)).toBe('restored')
    await service.chooseFolder()
    expect(deps.pickFolder).toHaveBeenCalledTimes(2)
    await service.dispose()
  })

  it('closes the old player when switching to another folder', async () => {
    const { service, players } = setup()
    await service.chooseFolder()
    await service.play()

    const view = await service.chooseFolder()
    expect(players[0]?.disposed).toBe(true)
    expect(view).toMatchObject({ status: 'ready', current: null })
  })

  it('drops a deleted file from the recent list', async () => {
    vi.useFakeTimers()
    const { service, players } = setup()
    await service.chooseFolder()
    await service.play()
    opened(players[0])
    const doomed = service.getView().current as string
    expect(service.getView().recent).toEqual([doomed])

    await service.deleteCurrent()
    expect(service.getView().recent).not.toContain(doomed)
    await service.dispose()
  })

  it('closes the player and cancels deletes still in the undo window on dispose', async () => {
    vi.useFakeTimers()
    const { service, players, trash } = setup()
    await service.chooseFolder()
    await service.play()
    opened(players[0])
    await service.deleteCurrent()

    await service.dispose()
    await vi.advanceTimersByTimeAsync(10000)
    expect(trash).not.toHaveBeenCalled()
    expect(players[0]?.disposed).toBe(true)
  })

  it('sends a view to listeners whenever something changes', async () => {
    const { service, players, views } = setup()
    await service.chooseFolder()
    await service.play()
    opened(players[0])
    expect(views.map((view) => view.status)).toEqual(
      expect.arrayContaining(['ready', 'starting-player', 'loading', 'playing'])
    )
  })
})
