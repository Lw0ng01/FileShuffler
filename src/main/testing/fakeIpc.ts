import type { IpcMainInvokeEvent } from 'electron'
import type { IpcRegistry } from '../ipc'

/**
 * Stands in for Electron's `ipcMain` in the IPC tests: keeps the handlers so a test can call them
 * as the window would. Test-only; nothing in the app imports it.
 */
export class FakeIpc implements IpcRegistry {
  readonly handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void {
    this.handlers.set(channel, listener)
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel)
  }

  invoke(channel: string, ...args: unknown[]): unknown {
    const handler = this.handlers.get(channel)
    if (handler === undefined) throw new Error(`No handler for ${channel}`)
    return handler({} as IpcMainInvokeEvent, ...args)
  }
}
