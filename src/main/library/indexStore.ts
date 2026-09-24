import type { IndexDb } from './indexDb'

/**
 * The index operations the rest of the app may use, by name. The worker answers only these, so a
 * message can never reach `close` or anything else on the class by accident.
 */
export const INDEX_METHODS = [
  'addRoot',
  'removeRoot',
  'excludedFolders',
  'excludeFolder',
  'includeFolder',
  'roots',
  'startScan',
  'putFiles',
  'finishRoot',
  'totalsByCategory',
  'totalsByDrive',
  'largest',
  'recent',
  'queryFiles',
  'search',
  'biggestFolders',
  'duplicateCandidates',
  'filesNamed',
  'notTouchedSince',
  'recordOpened',
  'recordFinished',
  'mostPlayed',
  'recentlyPlayed',
  'neverPlayed',
  'playTotals',
  'describeFile',
  'hasPlayed',
  'addFavorite',
  'removeFavorite',
  'favorites',
  'clearPlays',
  'clearFavorites',
  'clearIndex',
  'hasFile',
  'fileCount'
] as const satisfies readonly (keyof IndexDb)[]

export type IndexMethod = (typeof INDEX_METHODS)[number]

type Async<F> = F extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : never

/**
 * The index as the services see it: `IndexDb`'s operations, each answered later. In the app the
 * answers come from a worker thread (`workerIndexStore.ts`), so a slow query never freezes the
 * window (PROJECT.md §5 Measurements).
 */
export type IndexStore = { [K in IndexMethod]: Async<IndexDb[K]> }

const METHOD_NAMES: ReadonlySet<string> = new Set(INDEX_METHODS)

function isIndexMethod(name: unknown): name is IndexMethod {
  return typeof name === 'string' && METHOD_NAMES.has(name)
}

/** A request to the index worker. `close` shuts the database and ends the worker. */
export type IndexRequest =
  { id: number; method: IndexMethod; args: unknown[] } | { id: number; method: 'close'; args: [] }

/** What an error looks like after crossing threads: SQLite's code survives, the class doesn't. */
export interface IndexErrorData {
  message: string
  errcode?: number
}

export type IndexResponse =
  { id: number; ok: true; value: unknown } | { id: number; ok: false; error: IndexErrorData }

/** Sent once by the worker when it has opened the index, or failed to. */
export type IndexStartup =
  { type: 'ready'; setAside: string | null } | { type: 'failed'; error: IndexErrorData }

export function toErrorData(error: unknown): IndexErrorData {
  const message = error instanceof Error ? error.message : String(error)
  const errcode = (error as { errcode?: unknown } | null)?.errcode
  return typeof errcode === 'number' ? { message, errcode } : { message }
}

export function fromErrorData(data: IndexErrorData): Error {
  const error = new Error(data.message)
  return data.errcode === undefined ? error : Object.assign(error, { errcode: data.errcode })
}

/**
 * Runs one request against an open index and says how it went. Never throws: a failed query is an
 * answer like any other, so one bad request can't take the worker down.
 */
export function answerIndexRequest(db: IndexDb, request: unknown): IndexResponse | null {
  if (typeof request !== 'object' || request === null) return null
  const { id, method, args } = request as { id?: unknown; method?: unknown; args?: unknown }
  if (typeof id !== 'number') return null
  if (!isIndexMethod(method) || !Array.isArray(args)) {
    return { id, ok: false, error: { message: `Unknown index request: ${String(method)}` } }
  }
  try {
    const run = db[method] as (...values: unknown[]) => unknown
    return { id, ok: true, value: run.apply(db, args) }
  } catch (error) {
    return { id, ok: false, error: toErrorData(error) }
  }
}

/**
 * The same interface over an `IndexDb` in this thread, for tests. Answers arrive a turn later, as
 * they would from the worker, so code that forgets to wait fails here too.
 */
export function localIndexStore(db: IndexDb): IndexStore {
  const store: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const method of INDEX_METHODS) {
    store[method] = async (...args) => {
      await Promise.resolve()
      // Looked up per call, so a test can spy on the database after building a service.
      return (db[method] as (...values: unknown[]) => unknown).apply(db, args)
    }
  }
  return store as unknown as IndexStore
}
