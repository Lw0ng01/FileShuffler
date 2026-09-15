import { Duplex, PassThrough } from 'node:stream'

interface Request {
  requestId: number
  command: unknown[]
}

/**
 * Test double for the mpv side of the IPC connection. It parses what the client sends, answers
 * with `respond` (throw to reply with an error), and lets tests push events or raw text.
 */
export class FakeMpv {
  readonly requests: Request[] = []
  /** Reply data for a command. Throwing sends an mpv error reply with the thrown message. */
  respond: (command: unknown[]) => unknown = () => null
  /** When true, replies wait for `releaseReplies()` so tests can deliver events first. */
  holdReplies = false
  private readonly toMpv = new PassThrough()
  private readonly fromMpv = new PassThrough()
  private readonly heldReplies: Request[] = []
  private buffered = ''
  readonly socket: Duplex = Duplex.from({ readable: this.fromMpv, writable: this.toMpv })

  constructor() {
    this.toMpv.setEncoding('utf8')
    this.toMpv.on('data', (chunk: string) => {
      this.buffered += chunk
      let newline = this.buffered.indexOf('\n')
      while (newline !== -1) {
        const message = JSON.parse(this.buffered.slice(0, newline)) as {
          command: unknown[]
          request_id: number
        }
        this.buffered = this.buffered.slice(newline + 1)
        const request = { requestId: message.request_id, command: message.command }
        this.requests.push(request)
        if (this.holdReplies) this.heldReplies.push(request)
        else this.reply(request)
        newline = this.buffered.indexOf('\n')
      }
    })
  }

  get commands(): unknown[][] {
    return this.requests.map((request) => request.command)
  }

  releaseReplies(): void {
    this.holdReplies = false
    for (const request of this.heldReplies.splice(0)) this.reply(request)
  }

  send(message: object): void {
    this.fromMpv.write(JSON.stringify(message) + '\n')
  }

  sendRaw(text: string): void {
    this.fromMpv.write(text)
  }

  close(): void {
    this.socket.destroy()
  }

  private reply(request: Request): void {
    try {
      const data = this.respond(request.command)
      this.send({ request_id: request.requestId, error: 'success', data })
    } catch (error) {
      this.send({ request_id: request.requestId, error: (error as Error).message })
    }
  }
}

/** Lets queued stream callbacks and promise continuations run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10))
}
