import { describe, expect, it } from 'vitest'
import type { StatsView } from '../../shared/stats'
import type { ScanFile } from '../files/scanner'
import { IndexDb } from '../library/indexDb'
import { StatsService } from './statsService'

function indexed(path: string, overrides: Partial<ScanFile> = {}): ScanFile {
  return {
    path,
    root: 'D:\\Media',
    name: path.split('\\').pop() as string,
    folder: 'D:\\Media',
    drive: 'D:',
    category: 'video',
    size: 10,
    modifiedMs: 1,
    ...overrides
  }
}

function setup(): { db: IndexDb; service: StatsService; views: StatsView[] } {
  const db = new IndexDb(':memory:')
  const service = new StatsService({ db })
  const views: StatsView[] = []
  service.onView((view) => views.push(view))
  return { db, service, views }
}

describe('StatsService', () => {
  it('starts with nothing played', () => {
    const { service } = setup()
    expect(service.getView()).toEqual({
      totals: { plays: 0, finished: 0, files: 0, since: null },
      mostPlayed: [],
      recentlyPlayed: [],
      neverPlayed: [],
      favorites: [],
      lastError: null
    })
  })

  it('summarises play history alongside the index', () => {
    const { db, service } = setup()
    db.putFiles(db.startScan(), [indexed('D:\\Media\\seen.mp4'), indexed('D:\\Media\\unseen.mp4')])
    db.recordOpened('D:\\Media\\seen.mp4', 'seen.mp4', 'D:\\Media', 1_000)
    db.recordFinished('D:\\Media\\seen.mp4', 2_000)

    const view = service.getView()
    expect(view.totals).toEqual({ plays: 1, finished: 1, files: 1, since: 1_000 })
    expect(view.mostPlayed.map((row) => row.name)).toEqual(['seen.mp4'])
    expect(view.neverPlayed.map((row) => row.name)).toEqual(['unseen.mp4'])
  })

  it('stars a file from the index or from play history', () => {
    const { db, service } = setup()
    db.putFiles(db.startScan(), [indexed('D:\\Media\\indexed.mp4')])
    db.recordOpened('E:\\Shows\\played.mkv', 'played.mkv', 'E:\\Shows', 1)

    service.addFavorite('D:\\Media\\indexed.mp4')
    const view = service.addFavorite('E:\\Shows\\played.mkv')

    expect(view.favorites.map((row) => row.name).sort()).toEqual(['indexed.mp4', 'played.mkv'])
    expect(view.lastError).toBeNull()
  })

  it('refuses to star a path the app has never seen', () => {
    const { service } = setup()
    const view = service.addFavorite('C:\\Windows\\notepad.exe')

    expect(view.favorites).toEqual([])
    expect(view.lastError).toContain("isn't in the index or play history")
  })

  it('removes a favorite', () => {
    const { db, service } = setup()
    db.putFiles(db.startScan(), [indexed('D:\\Media\\a.mp4')])
    service.addFavorite('D:\\Media\\a.mp4')

    expect(service.removeFavorite('D:\\Media\\a.mp4').favorites).toEqual([])
  })

  it('lists more never-played videos on request, in the chosen order', () => {
    const { db, service } = setup()
    db.putFiles(db.startScan(), [
      indexed('D:\\Media\\small.mp4', { size: 1, modifiedMs: 20 }),
      indexed('D:\\Media\\big.mp4', { size: 900, modifiedMs: 10 })
    ])

    expect(service.neverPlayed(50, 'size').map((row) => row.name)).toEqual(['big.mp4', 'small.mp4'])
    expect(service.neverPlayed(1, 'modified').map((row) => row.name)).toEqual(['small.mp4'])
  })

  it('tells the window when something played', () => {
    const { db, service, views } = setup()
    db.recordOpened('D:\\Media\\a.mp4', 'a.mp4', 'D:\\Media', 1)
    service.notifyChanged()

    expect(views.at(-1)?.totals.plays).toBe(1)
  })
})
