import { describe, expect, it } from 'vitest'
import {
  buildCycleOrder,
  fisherYates,
  randomInt,
  seamSize,
  ShuffleSession,
  type RandomSource
} from './shuffle'

/** Small deterministic PRNG (mulberry32) so every test run sees the same "random" numbers. */
function seeded(seed: number): RandomSource {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Replays exact values, so a test can choose every random decision. */
function scripted(values: readonly number[]): RandomSource {
  let index = 0
  return () => {
    if (index >= values.length) throw new Error('scripted random source ran out of values')
    return values[index++] as number
  }
}

function names(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `video-${i}.mkv`)
}

function sorted(items: readonly string[]): string[] {
  return [...items].sort()
}

/** Draws forward until `cycles` complete cycles are collected. */
function drawCycles(session: ShuffleSession, cycles: number): string[][] {
  const result: string[][] = []
  for (;;) {
    const id = session.next()
    if (id === null) break
    const cycle = session.stats().cycle
    if (cycle > cycles) break
    ;(result[cycle - 1] ??= []).push(id)
  }
  return result
}

function expectSeamRule(previous: readonly string[], next: readonly string[]): void {
  const k = seamSize(next.length)
  if (k > 0) {
    const tail = new Set(previous.slice(-k))
    expect(next.slice(0, k).filter((id) => tail.has(id))).toEqual([])
  }
  if (next.length > 1) expect(next[0]).not.toBe(previous[previous.length - 1])
}

describe('randomInt', () => {
  it('clamps sources that return values outside [0, 1)', () => {
    expect(randomInt(() => 1, 5)).toBe(4)
    expect(randomInt(() => -0.5, 5)).toBe(0)
    expect(randomInt(() => 0.999999, 5)).toBe(4)
  })
})

describe('fisherYates', () => {
  it.each([3, 4])(
    'maps every sequence of random choices to a different order for %i items (unbiased)',
    (count) => {
      const items = names(count)
      // Fisher–Yates makes one choice per step, from ranges count, count-1, ..., 2.
      const ranges = Array.from({ length: count - 1 }, (_, step) => count - step)
      let choiceSequences: number[][] = [[]]
      for (const range of ranges) {
        choiceSequences = choiceSequences.flatMap((sequence) =>
          Array.from({ length: range }, (_, choice) => [...sequence, choice])
        )
      }

      const orders = choiceSequences.map((sequence) => {
        const values = sequence.map((choice, step) => (choice + 0.5) / (ranges[step] as number))
        return fisherYates(items, scripted(values)).join('|')
      })

      // n! equally likely choice sequences produce n! distinct orders: each order has the same
      // probability, which is exactly what "unbiased" means.
      const factorial = ranges.reduce((product, range) => product * range, 1)
      expect(orders).toHaveLength(factorial)
      expect(new Set(orders).size).toBe(factorial)
    }
  )

  it('returns a new array and leaves the input untouched', () => {
    const items = names(5)
    const copy = [...items]
    const shuffled = fisherYates(items, seeded(1))
    expect(items).toEqual(copy)
    expect(sorted(shuffled)).toEqual(sorted(items))
  })
})

describe('buildCycleOrder', () => {
  it('keeps the previous cycle’s last K items out of the first K positions', () => {
    for (const count of [3, 4, 5, 9, 30, 31, 45]) {
      for (let seed = 1; seed <= 200; seed++) {
        const random = seeded(seed * 1000 + count)
        const items = names(count)
        const previous = fisherYates(items, random)
        const order = buildCycleOrder(items, previous, random)
        expect(sorted(order)).toEqual(sorted(items))
        expectSeamRule(previous, order)
      }
    }
  })

  it('avoids an immediate repeat with two items, where K is zero', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const order = buildCycleOrder(['a', 'b'], ['a', 'b'], seeded(seed))
      expect(order).toEqual(['a', 'b'])
    }
  })

  it('handles empty and single-item sets', () => {
    expect(buildCycleOrder([], ['gone'], seeded(1))).toEqual([])
    expect(buildCycleOrder(['only'], ['only'], seeded(1))).toEqual(['only'])
  })
})

describe('ShuffleSession', () => {
  it('returns null for an empty folder', () => {
    const session = new ShuffleSession([], { random: seeded(1) })
    expect(session.next()).toBeNull()
    expect(session.current()).toBeNull()
  })

  it.each([1, 2, 3, 7, 31])('plays each of %i items once per cycle, cycle after cycle', (count) => {
    const items = names(count)
    const cycles = drawCycles(new ShuffleSession(items, { random: seeded(count) }), 4)
    expect(cycles).toHaveLength(4)
    cycles.forEach((cycle, index) => {
      expect(sorted(cycle)).toEqual(sorted(items))
      if (index > 0) expectSeamRule(cycles[index - 1] as string[], cycle)
    })
  })

  it('ignores duplicate IDs', () => {
    const session = new ShuffleSession(['a', 'a', 'b'], { random: seeded(1) })
    expect(session.stats().total).toBe(2)
  })

  it('continues a saved cycle instead of starting over', () => {
    const items = names(6)
    const first = new ShuffleSession(items, { random: seeded(3) })
    const played = [first.next() as string, first.next() as string]
    first.markOpened(played[0] as string)

    const resumed = new ShuffleSession(items, { random: seeded(9), restore: first.snapshot() })
    expect(resumed.stats()).toMatchObject({ cycle: 1, total: 6, opened: 1, remaining: 4 })

    const rest = Array.from({ length: 4 }, () => resumed.next() as string)
    expect(sorted([...played, ...rest])).toEqual(sorted(items))
  })

  it('reconciles a saved cycle with a folder that changed while the app was closed', () => {
    const first = new ShuffleSession(names(5), { random: seeded(4) })
    first.next()
    const saved = first.snapshot()

    // video-1.mkv was deleted elsewhere, and new.mkv appeared.
    const items = [...names(5).filter((id) => id !== 'video-1.mkv'), 'new.mkv']
    const resumed = new ShuffleSession(items, { random: seeded(5), restore: saved })
    expect(resumed.stats().total).toBe(5)

    const rest: string[] = []
    for (;;) {
      const id = resumed.next() as string
      if (resumed.stats().cycle > 1) break
      rest.push(id)
    }
    expect(rest).not.toContain('video-1.mkv')
    expect(rest).toContain('new.mkv')
    expect(new Set(rest).size).toBe(rest.length)
  })

  it('ignores saved names that no longer exist in the folder', () => {
    const session = new ShuffleSession(names(3), {
      random: seeded(6),
      restore: { cycle: 4, bag: ['gone-1.mkv'], cycleDraws: ['gone-2.mkv'], opened: ['gone-2.mkv'] }
    })
    expect(session.stats()).toMatchObject({ cycle: 4, total: 3, opened: 0, remaining: 3 })
    expect(sorted(Array.from({ length: 3 }, () => session.next() as string))).toEqual(
      sorted(names(3))
    )
  })

  it('restarts the cycle on request, without replaying what just played', () => {
    const items = names(12)
    const session = new ShuffleSession(items, { random: seeded(8) })
    const played = Array.from({ length: 6 }, () => session.next() as string)
    session.markOpened(played[0] as string)

    expect(session.restartCycle()).toBe(true)
    expect(session.stats()).toMatchObject({ cycle: 2, opened: 0, remaining: 12 })

    const after = Array.from({ length: 12 }, () => session.next() as string)
    expect(sorted(after)).toEqual(sorted(items))
    expect(after[0]).not.toBe(played[played.length - 1])
  })

  it('refuses to restart a cycle when there is nothing to play', () => {
    expect(new ShuffleSession([], { random: seeded(1) }).restartCycle()).toBe(false)
  })

  it('replays history with Back and Next without consuming the cycle', () => {
    const session = new ShuffleSession(names(5), { random: seeded(7) })
    const a = session.next()
    const b = session.next()
    const c = session.next()
    expect(session.stats().remaining).toBe(2)

    expect(session.back()).toBe(b)
    expect(session.back()).toBe(a)
    expect(session.back()).toBeNull()
    expect(session.current()).toBe(a)

    expect(session.next()).toBe(b)
    expect(session.next()).toBe(c)
    expect(session.stats().remaining).toBe(2)

    const d = session.next()
    expect([a, b, c]).not.toContain(d)
    expect(session.stats().remaining).toBe(1)
  })

  it('counts coverage only after a confirmed load', () => {
    const session = new ShuffleSession(names(3), { random: seeded(2) })
    const first = session.next() as string
    expect(session.stats().opened).toBe(0)
    session.markOpened(first)
    session.markOpened(first)
    session.markOpened('not-in-session')
    expect(session.stats().opened).toBe(1)
  })

  it('does not count replaying a previous cycle’s item toward the new cycle', () => {
    const session = new ShuffleSession(['a', 'b'], { random: seeded(3) })
    session.markOpened(session.next() as string)
    const lastOfCycleOne = session.next() as string
    session.markOpened(lastOfCycleOne)

    const firstOfCycleTwo = session.next() as string
    expect(session.stats().cycle).toBe(2)
    expect(firstOfCycleTwo).not.toBe(lastOfCycleOne)
    session.markOpened(firstOfCycleTwo)

    expect(session.back()).toBe(lastOfCycleOne)
    session.markOpened(lastOfCycleOne)
    expect(session.stats().opened).toBe(1)
  })

  it('skips failed items and stops instead of looping when nothing can play', () => {
    const session = new ShuffleSession(names(3), { random: seeded(4) })
    for (let i = 0; i < 3; i++) session.markFailed(session.next() as string)

    expect(session.next()).toBeNull()
    expect(session.stats()).toMatchObject({ cycle: 1, failed: 3, remaining: 0 })
  })

  it('never draws an item that failed earlier in the same cycle', () => {
    const session = new ShuffleSession(names(4), { random: seeded(5) })
    const first = session.next() as string
    session.markFailed(first)
    const rest = [session.next(), session.next(), session.next()]
    expect(rest).not.toContain(first)
    expect(session.back()).toBe(rest[1])
  })

  it('retries failed items in the next cycle when something played', () => {
    const items = names(3)
    const session = new ShuffleSession(items, { random: seeded(6) })
    session.markFailed(session.next() as string)
    session.markOpened(session.next() as string)
    session.markOpened(session.next() as string)

    const nextCycle = [session.next(), session.next(), session.next()] as string[]
    expect(session.stats().cycle).toBe(2)
    expect(sorted(nextCycle)).toEqual(sorted(items))
  })

  it('hides an item during a pending delete and restores it on undo', () => {
    const session = new ShuffleSession(names(5), { random: seeded(8) })
    const first = session.next() as string
    session.beginDelete(first)
    expect(session.stats().total).toBe(4)

    const second = session.next() as string
    expect(second).not.toBe(first)
    expect(session.back()).toBeNull()

    session.cancelDelete(first)
    expect(session.back()).toBe(first)
    expect(session.stats().total).toBe(5)
  })

  it('keeps an undrawn item for later in the cycle when its delete is undone', () => {
    const items = names(5)
    const session = new ShuffleSession(items, { random: seeded(9) })
    const first = session.next() as string
    const hidden = items.find((id) => id !== first) as string
    session.beginDelete(hidden)

    const others = [session.next(), session.next(), session.next()]
    expect(others).not.toContain(hidden)

    session.cancelDelete(hidden)
    expect(session.next()).toBe(hidden)
    expect(session.stats().cycle).toBe(1)
  })

  it('removes a completed delete everywhere and keeps the cursor valid', () => {
    const items = names(5)
    const session = new ShuffleSession(items, { random: seeded(10) })
    const a = session.next()
    const b = session.next() as string
    const c = session.next()

    expect(session.back()).toBe(b)
    session.beginDelete(b)
    session.completeDelete(b)
    expect(session.current()).toBe(a)
    expect(session.next()).toBe(c)
    expect(session.stats().total).toBe(4)

    const later = drawCycles(session, 3).flat()
    expect(later).not.toContain(b)
  })

  it('adds newly found files to the unplayed part of the current cycle', () => {
    const session = new ShuffleSession(['a', 'b', 'c'], { random: seeded(11) })
    const first = session.next() as string
    session.add(['d', 'a'])
    expect(session.stats()).toMatchObject({ total: 4, remaining: 3 })

    const restOfCycle = [session.next(), session.next(), session.next()] as string[]
    expect(session.stats().cycle).toBe(1)
    expect(sorted([first, ...restOfCycle])).toEqual(['a', 'b', 'c', 'd'])
  })

  it('bounds history without letting old items back into the current cycle', () => {
    const items = names(10)
    const session = new ShuffleSession(items, { random: seeded(12), maxHistory: 3 })
    const cycle = Array.from({ length: 10 }, () => session.next() as string)
    expect(sorted(cycle)).toEqual(sorted(items))

    expect(session.back()).toBe(cycle[8])
    expect(session.back()).toBe(cycle[7])
    expect(session.back()).toBeNull()
  })

  it('produces the same sequence for the same random source', () => {
    const run = (): string[] =>
      drawCycles(new ShuffleSession(names(8), { random: seeded(42) }), 2).flat()
    expect(run()).toEqual(run())
  })
})
