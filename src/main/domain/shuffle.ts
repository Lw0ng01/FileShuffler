/**
 * Shuffle engine: the pure rules of a shuffle session (PROJECT.md §3).
 *
 * No React, Electron, filesystem or player imports. Items are opaque string IDs (for example file
 * names); the application coordinator maps them to real files and player events.
 */

/** Returns a float in [0, 1). Injected so tests can be deterministic. */
export type RandomSource = () => number

/** Integer in [0, maxExclusive). Clamps a misbehaving source so the index is always valid. */
export function randomInt(random: RandomSource, maxExclusive: number): number {
  const value = Math.floor(random() * maxExclusive)
  return Math.min(Math.max(value, 0), maxExclusive - 1)
}

function swap<T>(items: T[], i: number, j: number): void {
  const held = items[i] as T
  items[i] = items[j] as T
  items[j] = held
}

/** Unbiased Fisher–Yates shuffle. Returns a new array and leaves the input untouched. */
export function fisherYates<T>(items: readonly T[], random: RandomSource): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    swap(result, i, randomInt(random, i + 1))
  }
  return result
}

/** K from PROJECT.md §3: how many items at each end of a cycle the seam rule protects. */
export function seamSize(itemCount: number): number {
  return Math.min(10, Math.floor(itemCount / 3))
}

/**
 * Order for a new cycle: a uniform shuffle, then the swaps needed so that
 * - none of the previous cycle's last K items lands in the first K positions, and
 * - with more than one item, the first item is not the one drawn last.
 *
 * Constructive, with no retry loop. Because K ≤ n/3 there are always enough other items to swap
 * in; if a changed item set ever made that impossible, the rest is left as shuffled.
 * These rules intentionally trade a little uniformity for no back-to-back repeats.
 */
export function buildCycleOrder(
  items: readonly string[],
  previousCycle: readonly string[],
  random: RandomSource
): string[] {
  const order = fisherYates(items, random)
  const k = seamSize(order.length)
  const tail = new Set(k > 0 ? previousCycle.slice(-k) : [])

  for (let i = 0; i < k; i++) {
    if (!tail.has(order[i] as string)) continue
    const candidates: number[] = []
    for (let j = k; j < order.length; j++) {
      if (!tail.has(order[j] as string)) candidates.push(j)
    }
    if (candidates.length === 0) break
    swap(order, i, candidates[randomInt(random, candidates.length)] as number)
  }

  const lastDrawn = previousCycle[previousCycle.length - 1]
  if (order.length > 1 && lastDrawn !== undefined && order[0] === lastDrawn) {
    swap(order, 0, 1 + randomInt(random, order.length - 1))
  }
  return order
}

export interface ShuffleSessionOptions {
  random?: RandomSource
  /** Most Back/Forward entries kept in memory. Cycle coverage is tracked separately. */
  maxHistory?: number
}

export interface ShuffleStats {
  cycle: number
  /** Items in the session, not counting ones hidden by a pending delete. */
  total: number
  /** Items drawn this cycle that the player confirmed it loaded. */
  opened: number
  /** Items that failed to load this cycle; skipped until the next cycle. */
  failed: number
  /** Available items still waiting to be drawn this cycle. */
  remaining: number
}

export class ShuffleSession {
  private readonly random: RandomSource
  private readonly maxHistory: number
  private readonly items = new Set<string>()
  /** Hidden during a delete's undo window; kept so undo can restore them. */
  private readonly pending = new Set<string>()
  private readonly opened = new Set<string>()
  private readonly failed = new Set<string>()
  private readonly drawnThisCycle = new Set<string>()
  /** Draw order of the current cycle, used for the seam rule when the next cycle starts. */
  private cycleDraws: string[] = []
  /** Items not yet drawn this cycle, in draw order. */
  private bag: string[]
  private history: string[] = []
  private cursor = -1
  private cycle = 1

  constructor(items: readonly string[], options: ShuffleSessionOptions = {}) {
    this.random = options.random ?? Math.random
    this.maxHistory = Math.max(1, options.maxHistory ?? 500)
    for (const id of items) this.items.add(id)
    this.bag = buildCycleOrder([...this.items], [], this.random)
  }

  /** The item at the history cursor, or null before anything has been drawn. */
  current(): string | null {
    return this.history[this.cursor] ?? null
  }

  /**
   * Moves forward. Replays history first (after Back) without consuming the cycle, then draws the
   * next item. Returns null when nothing can play: no items, or every available item failed.
   */
  next(): string | null {
    for (let i = this.cursor + 1; i < this.history.length; i++) {
      const id = this.history[i] as string
      if (this.isAvailable(id)) {
        this.cursor = i
        return id
      }
    }

    const drawn = this.draw()
    if (drawn === null) return null
    this.history.push(drawn)
    this.cursor = this.history.length - 1
    this.trimHistory()
    return drawn
  }

  /** Moves back through history, skipping unavailable items. Returns null at the start. */
  back(): string | null {
    for (let i = this.cursor - 1; i >= 0; i--) {
      const id = this.history[i] as string
      if (this.isAvailable(id)) {
        this.cursor = i
        return id
      }
    }
    return null
  }

  /** The player loaded this item. Counts toward coverage only if it was drawn this cycle. */
  markOpened(id: string): void {
    if (this.items.has(id) && this.drawnThisCycle.has(id)) this.opened.add(id)
  }

  /** The player could not load this item. It is skipped for the rest of the cycle. */
  markFailed(id: string): void {
    if (this.items.has(id)) this.failed.add(id)
  }

  /** A delete entered its undo window: hide the item but keep its state for undo. */
  beginDelete(id: string): void {
    if (this.items.has(id)) this.pending.add(id)
  }

  /** Undo, or the trash operation failed: the item becomes available again. */
  cancelDelete(id: string): void {
    this.pending.delete(id)
  }

  /** The item is in the trash: forget it everywhere and keep the history cursor valid. */
  completeDelete(id: string): void {
    if (!this.items.delete(id)) return
    this.pending.delete(id)
    this.opened.delete(id)
    this.failed.delete(id)
    this.drawnThisCycle.delete(id)
    this.cycleDraws = this.cycleDraws.filter((entry) => entry !== id)
    this.bag = this.bag.filter((entry) => entry !== id)

    // Point the cursor at the nearest remaining entry at or before its old position.
    const kept: string[] = []
    let cursor = -1
    this.history.forEach((entry, index) => {
      if (entry === id) return
      kept.push(entry)
      if (index <= this.cursor) cursor = kept.length - 1
    })
    this.history = kept
    this.cursor = cursor
  }

  /** Newly found files join the unplayed part of the current cycle at random positions. */
  add(ids: readonly string[]): void {
    for (const id of ids) {
      if (this.items.has(id)) continue
      this.items.add(id)
      this.bag.splice(randomInt(this.random, this.bag.length + 1), 0, id)
    }
  }

  stats(): ShuffleStats {
    return {
      cycle: this.cycle,
      total: this.items.size - this.pending.size,
      opened: [...this.opened].filter((id) => !this.pending.has(id)).length,
      failed: this.failed.size,
      remaining: this.bag.filter((id) => this.isAvailable(id)).length
    }
  }

  private isAvailable(id: string): boolean {
    return this.items.has(id) && !this.pending.has(id) && !this.failed.has(id)
  }

  private draw(): string | null {
    let index = this.bag.findIndex((id) => this.isAvailable(id))
    if (index === -1) {
      if (!this.startNextCycle()) return null
      index = this.bag.findIndex((id) => this.isAvailable(id))
      if (index === -1) return null
    }
    const id = this.bag.splice(index, 1)[0] as string
    this.cycleDraws.push(id)
    this.drawnThisCycle.add(id)
    return id
  }

  /** Returns false instead of starting a cycle when no item could play. */
  private startNextCycle(): boolean {
    const playable = [...this.items].some((id) => !this.pending.has(id) && !this.failed.has(id))
    if (!playable) return false

    this.bag = buildCycleOrder([...this.items], this.cycleDraws, this.random)
    this.cycle += 1
    this.cycleDraws = []
    this.drawnThisCycle.clear()
    this.opened.clear()
    this.failed.clear()
    return true
  }

  private trimHistory(): void {
    const excess = this.history.length - this.maxHistory
    if (excess > 0) {
      this.history.splice(0, excess)
      this.cursor -= excess
    }
  }
}
