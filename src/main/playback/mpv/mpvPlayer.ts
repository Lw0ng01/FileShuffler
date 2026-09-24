import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PlaybackAdapter, PlaybackEvent, PlayerCommand } from '../types'
import { MpvIpcClient, type MpvEvent } from './ipcClient'

/** First argument of every `script-message` sent by our key bindings. */
const MESSAGE_TARGET = 'fileshuffler'

/**
 * Written to the input.conf passed to mpv. `>` and `<` are mpv's own playlist next/previous keys,
 * so they keep a familiar meaning and leave arrow-key seeking alone. `DEL` is the Delete key on
 * Windows (fn+Delete on a Mac); the delete it starts can be undone.
 */
export const KEY_BINDINGS = [
  `> script-message ${MESSAGE_TARGET} next`,
  `< script-message ${MESSAGE_TARGET} back`,
  `DEL script-message ${MESSAGE_TARGET} delete`,
  ''
].join('\n')

/** How the bindings above are shown in the app. */
export const KEY_LABELS = { next: '>', back: '<', delete: 'Del' } as const

export interface MpvTimings {
  /** How long to wait for mpv to accept the IPC connection after starting. */
  connectTimeoutMs: number
  /** How long `unload()` waits for mpv to become idle. */
  unloadTimeoutMs: number
  /** How long `dispose()` waits for mpv to exit before force-stopping it. */
  quitTimeoutMs: number
  pollIntervalMs: number
}

const DEFAULT_TIMINGS: MpvTimings = {
  connectTimeoutMs: 5000,
  unloadTimeoutMs: 5000,
  quitTimeoutMs: 3000,
  pollIntervalMs: 50
}

export interface MpvLaunchOptions {
  mpvPath: string
  /** Extra mpv arguments, for example `--vo=null` in tests. The required arguments still win. */
  extraArgs?: readonly string[]
  timings?: Partial<MpvTimings>
}

/** The arguments every mpv process is started with (PROJECT.md §4). */
export function mpvArguments(
  socketPath: string,
  inputConfPath: string,
  extraArgs: readonly string[] = []
): string[] {
  // Extra arguments go first: when an option repeats, mpv uses the last value.
  return [
    ...extraArgs,
    // Ignore user config and scripts. Scripts such as autoload add files to mpv's own playlist and
    // play them outside the shuffle session.
    '--no-config',
    '--idle=yes',
    '--force-window=yes',
    // Report the end of a file instead of pausing on its last frame.
    '--keep-open=no',
    '--no-terminal',
    // Never fetch anything over the network (PROJECT.md §2.7).
    '--ytdl=no',
    '--input-default-bindings=yes',
    `--input-conf=${inputConfPath}`,
    `--input-ipc-server=${socketPath}`
  ]
}

/** Starts a dedicated mpv process and connects to it. */
export async function launchMpv(options: MpvLaunchOptions): Promise<MpvPlayer> {
  const timings = { ...DEFAULT_TIMINGS, ...options.timings }
  // mkdtemp creates a directory only this user can access, which also protects the socket inside.
  const workDir = await mkdtemp(join(tmpdir(), 'fileshuffler-mpv-'))
  const cleanup = (): Promise<void> => rm(workDir, { recursive: true, force: true })
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\fileshuffler-mpv-${randomUUID()}`
      : join(workDir, 'ipc.sock')
  const inputConfPath = join(workDir, 'input.conf')
  await writeFile(inputConfPath, KEY_BINDINGS)

  // Arguments are passed as an array with no shell, so nothing in them is interpreted as a command.
  const child = spawn(options.mpvPath, mpvArguments(socketPath, inputConfPath, options.extraArgs), {
    stdio: 'ignore'
  })
  const exited = new Promise<string>((resolve) => {
    child.once('exit', (code, signal) => resolve(signal ? `killed by ${signal}` : `code ${code}`))
    child.once('error', (error) => resolve(`failed to start: ${error.message}`))
  })

  try {
    const socket = await connectWhenReady(socketPath, exited, timings.connectTimeoutMs)
    const runtime: MpvRuntime = { exited, kill: () => child.kill(), cleanup }
    return new MpvPlayer(new MpvIpcClient(socket), runtime, timings)
  } catch (error) {
    child.kill()
    await cleanup()
    throw error
  }
}

/** The process-level pieces an `MpvPlayer` needs; replaced by fakes in unit tests. */
export interface MpvRuntime {
  /** Resolves with a short description once the mpv process is gone. */
  exited: Promise<string>
  /** Force-stops the process. */
  kill: () => void
  /** Removes the private temp directory. */
  cleanup: () => Promise<void>
}

type Outcome =
  { kind: 'loaded' } | { kind: 'ended' } | { kind: 'failed'; reason: string } | { kind: 'stopped' }

/** Upper bound on remembered early outcomes, so unexpected events can't grow memory. */
const MAX_EARLY_ENTRIES = 50

/** `PlaybackAdapter` backed by one long-running mpv process controlled over JSON IPC. */
export class MpvPlayer implements PlaybackAdapter {
  private readonly client: MpvIpcClient
  private readonly runtime: MpvRuntime
  private readonly timings: MpvTimings
  private readonly listeners = new Set<(event: PlaybackEvent) => void>()
  /** mpv playlist entry ID → our load token, learned from each `loadfile` reply. */
  private readonly tokensByEntry = new Map<number, number>()
  /**
   * Outcomes for entries whose `loadfile` reply hasn't arrived yet. mpv currently replies before
   * it starts the file, but its documentation says that ordering may change.
   */
  private readonly earlyOutcomes = new Map<number, Outcome[]>()
  /** Entry from the most recent `start-file`; `file-loaded` carries no ID of its own. */
  private startedEntry: number | null = null
  private nextToken = 1
  private exited = false
  private disposing: Promise<void> | null = null

  constructor(client: MpvIpcClient, runtime: MpvRuntime, timings: Partial<MpvTimings> = {}) {
    this.client = client
    this.runtime = runtime
    this.timings = { ...DEFAULT_TIMINGS, ...timings }
    client.onEvent((event) => this.handleEvent(event))
    client.onClose(() => this.markExited('mpv closed the IPC connection'))
    void runtime.exited.then((reason) => this.markExited(`mpv exited (${reason})`))
  }

  load(path: string): number {
    const token = this.nextToken++
    if (this.exited) {
      queueMicrotask(() => this.emit({ type: 'failed', token, reason: 'mpv is not running' }))
      return token
    }

    this.client.command(['loadfile', path, 'replace']).then(
      (data) => {
        const entry = entryIdOf(data)
        if (entry === null) {
          this.emit({ type: 'failed', token, reason: 'mpv did not report a playlist entry' })
          return
        }
        const early = this.earlyOutcomes.get(entry) ?? []
        this.earlyOutcomes.delete(entry)
        this.tokensByEntry.set(entry, token)
        for (const outcome of early) this.settle(entry, outcome)
      },
      (error: unknown) => this.emit({ type: 'failed', token, reason: errorMessage(error) })
    )
    return token
  }

  async unload(): Promise<void> {
    if (this.exited) return
    try {
      await this.client.command(['stop'])
      // `stop` replies before playback has actually stopped. Only once mpv is idle has it released
      // the file, which matters before trashing it (PROJECT.md §2.2).
      const deadline = Date.now() + this.timings.unloadTimeoutMs
      while ((await this.client.command(['get_property', 'idle-active'])) !== true) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for mpv to release the file')
        await delay(this.timings.pollIntervalMs)
      }
    } catch (error) {
      if (this.exited) return
      throw error
    }
  }

  onEvent(listener: (event: PlaybackEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): Promise<void> {
    this.disposing ??= this.shutdown()
    return this.disposing
  }

  private async shutdown(): Promise<void> {
    if (!this.exited) {
      await this.client.command(['quit']).catch(() => undefined)
      let timer: ReturnType<typeof setTimeout> | undefined
      const exitedInTime = await Promise.race([
        this.runtime.exited.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), this.timings.quitTimeoutMs)
        })
      ])
      clearTimeout(timer)
      if (!exitedInTime) this.runtime.kill()
    }
    this.client.close()
    await this.runtime.cleanup()
    this.markExited('player disposed')
  }

  private handleEvent(event: MpvEvent): void {
    switch (event.event) {
      case 'start-file':
        this.startedEntry = numberField(event, 'playlist_entry_id')
        return
      case 'file-loaded':
        if (this.startedEntry !== null) this.settle(this.startedEntry, { kind: 'loaded' })
        return
      case 'end-file': {
        const entry = numberField(event, 'playlist_entry_id')
        if (entry === null) return
        if (entry === this.startedEntry) this.startedEntry = null
        this.settle(entry, endOutcome(event))
        return
      }
      case 'client-message': {
        const args = event['args']
        if (Array.isArray(args) && args[0] === MESSAGE_TARGET && isPlayerCommand(args[1])) {
          this.emit({ type: 'command', command: args[1] })
        }
        return
      }
    }
  }

  private settle(entry: number, outcome: Outcome): void {
    const token = this.tokensByEntry.get(entry)
    if (token === undefined) {
      this.rememberEarly(entry, outcome)
      return
    }
    if (outcome.kind === 'loaded') this.emit({ type: 'loaded', token })
    else if (outcome.kind === 'ended') this.emit({ type: 'ended', token })
    else if (outcome.kind === 'failed') this.emit({ type: 'failed', token, reason: outcome.reason })
    // Anything other than "loaded" is the entry's last event.
    if (outcome.kind !== 'loaded') this.tokensByEntry.delete(entry)
  }

  private rememberEarly(entry: number, outcome: Outcome): void {
    const outcomes = this.earlyOutcomes.get(entry) ?? []
    outcomes.push(outcome)
    this.earlyOutcomes.set(entry, outcomes)
    if (this.earlyOutcomes.size > MAX_EARLY_ENTRIES) {
      const oldest = this.earlyOutcomes.keys().next().value
      if (oldest !== undefined) this.earlyOutcomes.delete(oldest)
    }
  }

  private markExited(reason: string): void {
    if (this.exited) return
    this.exited = true
    this.startedEntry = null
    this.tokensByEntry.clear()
    this.earlyOutcomes.clear()
    this.emit({ type: 'exited', reason })
  }

  private emit(event: PlaybackEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }
}

async function connectWhenReady(
  socketPath: string,
  exited: Promise<string>,
  timeoutMs: number
): Promise<Socket> {
  const process = { exitReason: null as string | null }
  void exited.then((reason) => {
    process.exitReason = reason
  })
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (process.exitReason !== null) {
      throw new Error(`mpv stopped before it was ready (${process.exitReason})`)
    }
    try {
      return await tryConnect(socketPath)
    } catch {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for mpv to accept connections')
      await delay(50)
    }
  }
}

function tryConnect(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath)
    const onError = (error: Error): void => {
      socket.destroy()
      reject(error)
    }
    socket.once('error', onError)
    socket.once('connect', () => {
      socket.off('error', onError)
      resolve(socket)
    })
  })
}

function endOutcome(event: MpvEvent): Outcome {
  switch (event['reason']) {
    case 'eof':
      return { kind: 'ended' }
    case 'error':
      return { kind: 'failed', reason: stringField(event, 'file_error') ?? 'playback error' }
    default:
      // stop, quit, redirect or unknown: replaced or stopped by a command, not a natural end.
      return { kind: 'stopped' }
  }
}

function numberField(event: MpvEvent, name: string): number | null {
  const value = event[name]
  return typeof value === 'number' ? value : null
}

function stringField(event: MpvEvent, name: string): string | null {
  const value = event[name]
  return typeof value === 'string' ? value : null
}

function entryIdOf(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null
  const value = (data as Record<string, unknown>)['playlist_entry_id']
  return typeof value === 'number' ? value : null
}

function isPlayerCommand(value: unknown): value is PlayerCommand {
  return value === 'next' || value === 'back' || value === 'delete'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
