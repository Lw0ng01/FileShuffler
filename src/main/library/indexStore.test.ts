import { describe, expect, it } from 'vitest'
import { IndexDb } from './indexDb'
import { answerIndexRequest, fromErrorData, localIndexStore, toErrorData } from './indexStore'

describe('answerIndexRequest', () => {
  it('runs an index operation and returns its result', () => {
    const db = new IndexDb(':memory:')
    expect(answerIndexRequest(db, { id: 1, method: 'addRoot', args: ['D:\\Media'] })).toEqual({
      id: 1,
      ok: true,
      value: undefined
    })
    expect(answerIndexRequest(db, { id: 2, method: 'roots', args: [] })).toMatchObject({
      id: 2,
      ok: true,
      value: [{ path: 'D:\\Media', files: 0 }]
    })
    db.close()
  })

  it('answers anything outside the list of operations with an error, never by running it', () => {
    const db = new IndexDb(':memory:')
    expect(answerIndexRequest(db, { id: 3, method: 'close', args: [] })).toEqual({
      id: 3,
      ok: false,
      error: { message: 'Unknown index request: close' }
    })
    expect(answerIndexRequest(db, { id: 4, method: 'constructor', args: [] })).toMatchObject({
      ok: false
    })
    expect(db.roots()).toEqual([])
    db.close()
  })

  it('turns a failing operation into an error answer', () => {
    const db = new IndexDb(':memory:')
    db.close()
    const answer = answerIndexRequest(db, { id: 5, method: 'roots', args: [] })
    expect(answer).toMatchObject({ id: 5, ok: false })
  })

  it('ignores messages that are not requests at all', () => {
    const db = new IndexDb(':memory:')
    expect(answerIndexRequest(db, null)).toBeNull()
    expect(answerIndexRequest(db, { method: 'roots', args: [] })).toBeNull()
    db.close()
  })
})

describe('index errors across threads', () => {
  it("keeps SQLite's result code", () => {
    const original = Object.assign(new Error('file is not a database'), { errcode: 26 })
    const rebuilt = fromErrorData(toErrorData(original))
    expect(rebuilt.message).toBe('file is not a database')
    expect((rebuilt as Error & { errcode?: number }).errcode).toBe(26)
    expect(toErrorData('plain')).toEqual({ message: 'plain' })
  })
})

describe('localIndexStore', () => {
  it('answers a turn later, like the worker', async () => {
    const db = new IndexDb(':memory:')
    const store = localIndexStore(db)
    let answered = false
    const pending = store.addRoot('D:\\Media').then(() => {
      answered = true
    })
    expect(answered).toBe(false)
    await pending
    expect(await store.roots()).toHaveLength(1)
    db.close()
  })
})
