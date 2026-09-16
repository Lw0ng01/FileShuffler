import type { IpcMainInvokeEvent } from 'electron'
import { CLEARABLE_DATA, SETTINGS_CHANNELS, type ClearableData } from '../shared/settings'
import type { SettingsService } from './app/settingsService'
import type { IpcRegistry } from './ipc'

export type SettingsBackend = Pick<
  SettingsService,
  'getView' | 'chooseMpv' | 'useDefaultMpv' | 'testMpv' | 'clearData'
>

function asClearable(value: unknown): ClearableData {
  if (typeof value !== 'string' || !(CLEARABLE_DATA as readonly string[]).includes(value)) {
    throw new Error('Expected data that Settings knows how to clear')
  }
  return value as ClearableData
}

/**
 * Registers the Settings commands, with the same rules as the other areas (PROJECT.md §5): the
 * app's own window only, arguments checked at runtime. None of them take a path: choosing mpv
 * goes through the system's own file picker in main, so the page can never name a program to run.
 * Returns a function that removes the handlers.
 */
export function registerSettingsIpc(
  ipc: IpcRegistry,
  backend: SettingsBackend,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
): () => void {
  const channels: string[] = []
  const handle = (channel: string, run: (args: unknown[]) => unknown): void => {
    channels.push(channel)
    ipc.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) throw new Error('Rejected a request from an untrusted sender')
      return run(args)
    })
  }

  handle(SETTINGS_CHANNELS.getView, () => backend.getView())
  handle(SETTINGS_CHANNELS.chooseMpv, () => backend.chooseMpv())
  handle(SETTINGS_CHANNELS.useDefaultMpv, () => backend.useDefaultMpv())
  handle(SETTINGS_CHANNELS.testMpv, () => backend.testMpv())
  handle(SETTINGS_CHANNELS.clearData, ([what]) => backend.clearData(asClearable(what)))

  return () => {
    for (const channel of channels) ipc.removeHandler(channel)
  }
}
