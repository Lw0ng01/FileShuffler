import type { IpcMainEvent } from 'electron'
import {
  PLAYER_CHANNELS,
  type PlayerCommandMessage,
  type PlayerEventMessage
} from '../shared/player'
import type { PlayerTransport } from './playback/embedded/embeddedPlayer'
import type { VideoSources } from './playback/embedded/videoSources'

/**
 * Joins the built-in player's adapter to Electron, with the same sender and argument checks as
 * `ipc.ts`. Playback events arrive as one-way messages rather than invokes, because they are a
 * stream of notifications and nothing waits on a reply.
 *
 * The renderer can only ever say what happened to a load it was given. It cannot name a file, ask
 * for one, or reach the sources map - that is the whole reason the wire carries tokens.
 */

/** The part of Electron's `ipcMain` used here, so tests can pass a fake. */
export interface PlayerIpcRegistry {
  on(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): void
  removeAllListeners(channel: string): void
}

export interface PlayerIpcOptions {
  ipc: PlayerIpcRegistry
  sources: VideoSources
  /** Sends a command to the window, or does nothing when there is no window. */
  sendToWindow: (channel: string, payload: unknown) => void
  /** True while the window is open and its page has said it is ready. */
  isLive: () => boolean
  isTrustedSender: (event: IpcMainEvent) => boolean
  /** Called when the page announces itself, so a reopened window is noticed. */
  onReady: () => void
}

/** Builds the transport the adapter talks through, and returns a teardown. */
export function createPlayerTransport(options: PlayerIpcOptions): {
  transport: PlayerTransport
  dispose: () => void
} {
  const listeners = new Set<(message: PlayerEventMessage) => void>()

  options.ipc.on(PLAYER_CHANNELS.ready, (event) => {
    if (!options.isTrustedSender(event)) return
    options.onReady()
  })

  options.ipc.on(PLAYER_CHANNELS.event, (event, ...args) => {
    if (!options.isTrustedSender(event)) return
    const message = asEventMessage(args[0])
    if (message === null) return
    for (const listener of [...listeners]) listener(message)
  })

  const transport: PlayerTransport = {
    isLive: () => options.isLive(),
    send: (command: PlayerCommandMessage) => options.sendToWindow(PLAYER_CHANNELS.command, command),
    onMessage: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setSource: (token, path) => options.sources.set(token, path),
    clearSources: () => options.sources.clear()
  }

  return {
    transport,
    dispose: () => {
      listeners.clear()
      options.ipc.removeAllListeners(PLAYER_CHANNELS.ready)
      options.ipc.removeAllListeners(PLAYER_CHANNELS.event)
    }
  }
}

/**
 * Nothing over IPC is typed at runtime, so every field is checked before it is believed. An
 * unrecognised message is dropped rather than guessed at.
 */
export function asEventMessage(value: unknown): PlayerEventMessage | null {
  if (typeof value !== 'object' || value === null) return null
  const message = value as Record<string, unknown>

  switch (message['type']) {
    case 'loaded':
    case 'ended':
      return isToken(message['token'])
        ? ({ type: message['type'], token: message['token'] } as PlayerEventMessage)
        : null
    case 'failed':
      return isToken(message['token']) && typeof message['reason'] === 'string'
        ? { type: 'failed', token: message['token'], reason: message['reason'].slice(0, 200) }
        : null
    case 'unloaded':
      return isToken(message['requestId'])
        ? { type: 'unloaded', requestId: message['requestId'] }
        : null
    default:
      return null
  }
}

function isToken(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
