import { parentPort, workerData } from 'node:worker_threads'
import type { IndexDb } from './indexDb'
import { answerIndexRequest, toErrorData, type IndexStartup } from './indexStore'
import { openIndex } from './openIndex'

/**
 * The index worker thread. It owns the database connection and answers requests from the main
 * process one at a time (`workerIndexStore.ts`), so SQLite's synchronous work never blocks the
 * window. Opening happens here too, including setting a damaged index aside (`openIndex.ts`).
 */
const port = parentPort
if (port === null) throw new Error('indexWorker.ts must run as a worker thread')

const { file } = workerData as { file: string }
let db: IndexDb | null = null
let startup: IndexStartup
try {
  const opened = openIndex(file)
  db = opened.db
  startup = { type: 'ready', setAside: opened.setAside }
} catch (error) {
  startup = { type: 'failed', error: toErrorData(error) }
}
port.postMessage(startup)

port.on('message', (request: unknown) => {
  const { id, method } = (request ?? {}) as { id?: unknown; method?: unknown }
  if (method === 'close' && typeof id === 'number') {
    db?.close()
    db = null
    port.postMessage({ id, ok: true, value: undefined })
    port.close()
    return
  }
  if (db === null) {
    if (typeof id === 'number') {
      port.postMessage({ id, ok: false, error: { message: "The index couldn't be opened." } })
    }
    return
  }
  const response = answerIndexRequest(db, request)
  if (response !== null) port.postMessage(response)
})
