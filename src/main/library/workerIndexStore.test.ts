import { describe, expect, it } from 'vitest'
import type { IndexRequest } from './indexStore'
import { connectIndexWorker, type WorkerLike } from './workerIndexStore'

/** A stand-in worker: records requests and lets the test answer, fail or stop it. */
class FakeWorker implements WorkerLike {
  readonly requests: IndexRequest[] = []
  private readonly listeners: Record<string, ((value: never) => void)[]> = {}

  postMessage(value: IndexRequest): void {
    this.requests.push(value)
  }

  on(event: 'message' | 'error' | 'exit', listener: (value: never) => void): this {
    ;(this.listeners[event] ??= []).push(listener)
    return this
  }

  emit(event: 'message' | 'error' | 'exit', value: unknown): void {
    for (const listener of this.listeners[event] ?? []) listener(value as never)
  }

  answer(id: number, value: unknown): void {
    this.emit('message', { id, ok: true, value })
  }
}

describe('connectIndexWorker', () => {
  it('sends requests in order and matches each answer to its request', async () => {
    const worker = new FakeWorker()
    const { store } = connectIndexWorker(worker)

    const roots = store.roots()
    const count = store.fileCount()
    expect(worker.requests).toEqual([
      { id: 1, method: 'roots', args: [] },
      { id: 2, method: 'fileCount', args: [] }
    ])

    worker.answer(2, 7)
    worker.answer(1, [])
    await expect(count).resolves.toBe(7)
    await expect(roots).resolves.toEqual([])
  })

  it('rejects with the error the worker reported, keeping its code', async () => {
    const worker = new FakeWorker()
    const { store } = connectIndexWorker(worker)
    const pending = store.roots()
    worker.emit('message', { id: 1, ok: false, error: { message: 'disk I/O error', errcode: 10 } })

    await expect(pending).rejects.toMatchObject({ message: 'disk I/O error', errcode: 10 })
  })

  it('reports the damaged index the worker set aside once it is ready', async () => {
    const worker = new FakeWorker()
    const { ready } = connectIndexWorker(worker)
    worker.emit('message', { type: 'ready', setAside: 'index.db.unreadable-1' })

    await expect(ready).resolves.toEqual({ setAside: 'index.db.unreadable-1' })
  })

  it('fails everything when the index could not be opened', async () => {
    const worker = new FakeWorker()
    const { store, ready } = connectIndexWorker(worker)
    const waiting = store.roots()
    worker.emit('message', { type: 'failed', error: { message: 'database is locked' } })

    await expect(ready).rejects.toThrow('database is locked')
    await expect(waiting).rejects.toThrow('database is locked')
    await expect(store.fileCount()).rejects.toThrow('database is locked')
  })

  it('never leaves a request hanging when the worker dies', async () => {
    const worker = new FakeWorker()
    const { store } = connectIndexWorker(worker)
    const waiting = store.roots()
    worker.emit('exit', 1)

    await expect(waiting).rejects.toThrow('The index stopped (exit code 1).')
    await expect(store.roots()).rejects.toThrow('The index stopped')
    expect(worker.requests).toHaveLength(1)
  })

  it('closes once, after the requests already sent, and refuses new ones', async () => {
    const worker = new FakeWorker()
    const { store, close } = connectIndexWorker(worker)
    const earlier = store.recordFinished('D:\\a.mp4')

    const closing = close()
    expect(close()).toBe(closing)
    expect(worker.requests.map((request) => request.method)).toEqual(['recordFinished', 'close'])
    await expect(store.roots()).rejects.toThrow('The index is closed.')

    worker.answer(1, undefined)
    worker.answer(2, undefined)
    worker.emit('exit', 0)
    await expect(earlier).resolves.toBeUndefined()
    await expect(closing).resolves.toBeUndefined()
  })
})
