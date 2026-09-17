import {
  fromErrorData,
  INDEX_METHODS,
  type IndexMethod,
  type IndexRequest,
  type IndexResponse,
  type IndexStartup,
  type IndexStore
} from './indexStore'

/** The parts of `worker_threads.Worker` used here, so tests can stand in a fake. */
export interface WorkerLike {
  postMessage(value: IndexRequest): void
  on(event: 'message', listener: (value: unknown) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
}

export interface IndexWorkerClient {
  store: IndexStore
  /** Settles once the worker has opened the index, with any damaged file it set aside. */
  ready: Promise<{ setAside: string | null }>
  /** Finishes the requests already sent, closes the database, and ends the worker. */
  close(): Promise<void>
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

function isStartup(value: unknown): value is IndexStartup {
  return typeof value === 'object' && value !== null && 'type' in value
}

/**
 * Talks to the index worker (`indexWorker.ts`). The worker handles one request at a time, in the
 * order sent, so a batch written before a sweep is always in place when the sweep runs.
 *
 * Requests can be sent straight away: the worker picks them up once the index is open. If the
 * worker fails or stops, every waiting request is rejected and later ones fail at once, so
 * nothing hangs.
 */
export function connectIndexWorker(worker: WorkerLike): IndexWorkerClient {
  const pending = new Map<number, Pending>()
  let nextId = 1
  let stopped: Error | null = null
  let closing: Promise<void> | null = null

  let settleReady: {
    resolve: (value: { setAside: string | null }) => void
    reject: (e: Error) => void
  }
  const ready = new Promise<{ setAside: string | null }>((resolve, reject) => {
    settleReady = { resolve, reject }
  })
  // A startup failure is handled by whoever awaits `ready`; don't also report it as unhandled.
  ready.catch(() => undefined)

  const stop = (error: Error): void => {
    if (stopped !== null) return
    stopped = error
    settleReady.reject(error)
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }

  worker.on('message', (message) => {
    if (isStartup(message)) {
      if (message.type === 'ready') settleReady.resolve({ setAside: message.setAside })
      else stop(fromErrorData(message.error))
      return
    }
    const response = message as IndexResponse
    const entry = pending.get(response.id)
    if (entry === undefined) return
    pending.delete(response.id)
    if (response.ok) entry.resolve(response.value)
    else entry.reject(fromErrorData(response.error))
  })
  worker.on('error', (error) => stop(error))
  worker.on('exit', (code) => stop(new Error(`The index stopped (exit code ${code}).`)))

  const send = (method: IndexMethod | 'close', args: unknown[]): Promise<unknown> => {
    if (stopped !== null) return Promise.reject(stopped)
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      worker.postMessage({ id, method, args } as IndexRequest)
    })
  }

  const store: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const method of INDEX_METHODS) {
    store[method] = (...args) =>
      closing === null ? send(method, args) : Promise.reject(new Error('The index is closed.'))
  }

  return {
    store: store as unknown as IndexStore,
    ready,
    close: () => {
      closing ??= send('close', []).then(
        () => undefined,
        () => undefined
      )
      return closing
    }
  }
}
