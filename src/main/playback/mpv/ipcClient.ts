import type { Duplex } from 'node:stream'

/** An mpv event message, for example `{ "event": "end-file", "reason": "eof", ... }`. */
export interface MpvEvent {
  event: string
  [field: string]: unknown
}

interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (error: Error) => void
}

/**
 * mpv's JSON IPC protocol over a connected Unix socket or Windows named pipe: one JSON message
 * per line, replies matched by `request_id`, everything else is an event.
 * Reference: https://mpv.io/manual/master/#json-ipc
 */
export class MpvIpcClient {
  private readonly socket: Duplex
  private readonly pending = new Map<number, PendingRequest>()
  private readonly eventListeners = new Set<(event: MpvEvent) => void>()
  private readonly closeListeners = new Set<() => void>()
  private buffered = ''
  private nextRequestId = 1
  private closed = false

  constructor(socket: Duplex) {
    this.socket = socket
    // Decoding here keeps multi-byte UTF-8 characters intact when they are split across chunks.
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => this.receive(chunk))
    socket.on('error', () => this.handleClose())
    socket.on('close', () => this.handleClose())
  }

  /** Sends a command and resolves with mpv's reply data, or rejects if mpv reports an error. */
  command(args: readonly unknown[]): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('mpv IPC connection is closed'))
    const requestId = this.nextRequestId++
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      // JSON.stringify escapes newlines inside strings, so every message stays on one line.
      this.socket.write(JSON.stringify({ command: args, request_id: requestId }) + '\n')
    })
  }

  onEvent(listener: (event: MpvEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  close(): void {
    this.socket.destroy()
    this.handleClose()
  }

  private receive(chunk: string): void {
    this.buffered += chunk
    let newline = this.buffered.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffered.slice(0, newline).trim()
      this.buffered = this.buffered.slice(newline + 1)
      if (line !== '') this.dispatch(line)
      newline = this.buffered.indexOf('\n')
    }
  }

  private dispatch(line: string): void {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      // mpv documents that it can emit invalid UTF-8 in corner cases; skip lines we can't parse.
      return
    }
    if (typeof message !== 'object' || message === null) return
    const record = message as Record<string, unknown>

    if (typeof record['event'] === 'string') {
      for (const listener of [...this.eventListeners]) listener(record as MpvEvent)
      return
    }

    const requestId = record['request_id']
    if (typeof requestId !== 'number') return
    const request = this.pending.get(requestId)
    if (request === undefined) return
    this.pending.delete(requestId)
    if (record['error'] === 'success') request.resolve(record['data'])
    else request.reject(new Error(`mpv command failed: ${String(record['error'])}`))
  }

  private handleClose(): void {
    if (this.closed) return
    this.closed = true
    for (const request of this.pending.values()) {
      request.reject(new Error('mpv IPC connection closed'))
    }
    this.pending.clear()
    for (const listener of [...this.closeListeners]) listener()
  }
}
